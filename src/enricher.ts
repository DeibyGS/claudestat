/**
 * enricher.ts — Watcher multi-CLI usando adapters
 *
 * En lugar de hardcodear la lógica de Claude Code, usa el adapter pattern
 * para soportar múltiples coding CLIs (Claude Code, Codex, OpenCode, etc.).
 *
 * Cada adapter implementa WatcherAdapter (src/watchers/adapter.ts):
 * - detect()      → si el CLI está instalado
 * - getWatchPaths() → qué archivos observar
 * - parseEvent()   → parsear una línea de trace
 * - getSessionCost() → calcular costos acumulados
 */

import chokidar from 'chokidar'
import path from 'path'
import fsSync from 'fs'
import { getActiveAdapters, getAdapter, isPollable, type WatcherAdapter } from './watchers/adapter'
import './watchers/claude-code'
import './watchers/codex'
import './watchers/opencode'
import './watchers/amp'
import './watchers/droid'
import './watchers/codebuff'
import { dbOps, type CostUpdate } from './db'
// Re-export Claude Code-specific utilities for routes/stream and routes/misc
export { getAllBlockCostsForSession, getSessionPrompts } from './watchers/claude-code'
export { getContextWindow } from './pricing'

export type CostUpdateCallback     = (sessionId: string, cost: CostUpdate, source?: string) => void
export type CompactDetectedCallback = (sessionId: string) => void

const prevContextBySession = new Map<string, number>()

let watcher: chokidar.FSWatcher | null = null
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>()
const fileLocks = new Map<string, Promise<void>>()
const pollIntervals: ReturnType<typeof setInterval>[] = []

// ─── Adapter lookup por filePath ───────────────────────────────────────────────

const adapterByDir = new Map<string, WatcherAdapter>()

function findAdapter(filePath: string): WatcherAdapter | undefined {
  for (const [dir, adapter] of adapterByDir) {
    if (filePath.startsWith(dir)) return adapter
  }
  return undefined
}

// ─── Procesamiento de archivos ─────────────────────────────────────────────────

async function processFile(filePath: string): Promise<{ sessionId: string; cost: CostUpdate; source: string } | null> {
  if (fileLocks.has(filePath)) return null
  fileLocks.set(filePath, Promise.resolve())

  try {
    const adapter = findAdapter(filePath)
    if (!adapter) return null

    const sessionId = path.basename(filePath, '.jsonl')
    if (!sessionId.includes('-') || sessionId.length < 10) return null

    const cost = await adapter.getSessionCost(filePath)
    if (!cost || cost.cost_usd < 0) return null

    return { sessionId, cost, source: adapter.name }
  } finally {
    fileLocks.delete(filePath)
  }
}

// ─── Start / Stop ──────────────────────────────────────────────────────────────

export function startEnricher(
  onUpdate: CostUpdateCallback,
  onCompact?: CompactDetectedCallback,
) {
  const adapters = getActiveAdapters()
  if (adapters.length === 0) {
    console.warn('[enricher] No supported CLI tools detected')
    return
  }

  // Index directories for adapter lookup
  for (const a of adapters) {
    for (const watchPath of a.getWatchPaths()) {
      // Extract base directory from glob pattern
      const baseDir = watchPath.split('/**')[0]
      if (baseDir) adapterByDir.set(baseDir, a)
    }
  }

  const watchPaths = adapters.flatMap(a => a.getWatchPaths())
  console.log(`[enricher] Watching ${adapters.map(a => a.label).join(', ')}`)

  watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  })

  const handleFile = (filePath: string) => {
    const existing = pendingFiles.get(filePath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      pendingFiles.delete(filePath)
      const result = await processFile(filePath)
      if (!result) return

      const { sessionId, cost, source } = result
      const prev = prevContextBySession.get(sessionId)
      if (onCompact && prev !== undefined && prev > 140_000 && cost.context_used < prev * 0.5) {
        onCompact(sessionId)
      }
      prevContextBySession.set(sessionId, cost.context_used)
      onUpdate(sessionId, cost, source)
    }, 100)

    pendingFiles.set(filePath, timer)
  }

  watcher.on('change', handleFile)
  watcher.on('add', handleFile)

  // ─── Poll-based adapters (e.g. OpenCode SQLite) ─────────────────────────────
  const POLL_INTERVAL_MS = 10_000
  const POLL_LOOKBACK_MS = 7 * 24 * 60 * 60_000  // backfill 7 days on first start
  for (const adapter of adapters) {
    if (!isPollable(adapter)) continue
    let lastPoll = Date.now() - POLL_LOOKBACK_MS
    const interval = setInterval(async () => {
      const since = lastPoll
      lastPoll = Date.now()
      const sessions = await adapter.pollSessions(since)
      for (const { sessionId, cost, cwd } of sessions) {
        onUpdate(sessionId, cost, adapter.name)
        if (cwd) dbOps.updateSessionProject(sessionId, cwd)
      }
    }, POLL_INTERVAL_MS)
    interval.unref()
    pollIntervals.push(interval)
  }
}

export function stopEnricher() {
  if (watcher) { watcher.close(); watcher = null }
  for (const [, timer] of pendingFiles) clearTimeout(timer)
  pendingFiles.clear()
  for (const interval of pollIntervals) clearInterval(interval)
  pollIntervals.length = 0
  prevContextBySession.clear()
  adapterByDir.clear()
  console.log('[enricher] Stopped')
}

export function cleanupSession(sessionId: string) {
  prevContextBySession.delete(sessionId)
}

// ─── Legacy: processLatestForSession (now adapter-agnostic) ─────────────────────

export async function processLatestForSession(
  sessionId: string,
  onUpdate: CostUpdateCallback,
  source?: string
): Promise<void> {
  const adapters = source
    ? [getAdapter(source)].filter(Boolean) as WatcherAdapter[]
    : getActiveAdapters()

  for (const adapter of adapters) {
    if (isPollable(adapter)) continue

    for (const watchPath of adapter.getWatchPaths()) {
      const baseDir = watchPath.split('/**')[0]
      if (!baseDir) continue
      if (!fsSync.existsSync(baseDir)) continue

      const dirs = fsSync.readdirSync(baseDir)
      for (const dir of dirs) {
        const dirPath = path.join(baseDir, dir)
        try {
          if (!fsSync.statSync(dirPath).isDirectory()) continue
        } catch { continue }

        const filePath = path.join(dirPath, `${sessionId}.jsonl`)
        if (!fsSync.existsSync(filePath)) continue

        const cost = await adapter.getSessionCost(filePath)
        if (cost && cost.cost_usd >= 0) {
          onUpdate(sessionId, cost, adapter.name)
        }
        return
      }
    }
  }
}
