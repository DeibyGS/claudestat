/**
 * enricher.ts — Enriquecedor de coste desde JSONL de Claude Code
 *
 * Claude Code escribe los tokens de cada respuesta en:
 *   ~/.claude/projects/{project-hash}/{session-id}.jsonl
 *
 * Cada línea de tipo "assistant" contiene:
 *   message.usage.input_tokens
 *   message.usage.output_tokens
 *   message.usage.cache_read_input_tokens
 *   message.usage.cache_creation_input_tokens
 *   message.model
 *
 * El enricher observa cambios en esos archivos (con chokidar),
 * calcula el coste acumulado por sesión y llama al callback
 * para que el daemon actualice la DB y haga broadcast via SSE.
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import chokidar from 'chokidar'
import { getClaudeDir } from './paths'
import type { CostUpdate } from './db'

// ─── Tabla de precios (USD por millón de tokens) ──────────────────────────────

interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':            { input: 15,   output: 75,  cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-sonnet-4-6':          { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5':           { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
}

const DEFAULT_PRICING = PRICING['claude-sonnet-4-6']

interface UsageEntry {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// ─── Context window dinámico ──────────────────────────────────────────────────

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5':  200_000,
}

export function getContextWindow(model: string): number {
  return KNOWN_CONTEXT_WINDOWS[model] ?? 200_000
}

// ─── Calculo de coste ─────────────────────────────────────────────────────────

function calcCost(model: string, usage: UsageEntry): number {
  const price = PRICING[model] ?? DEFAULT_PRICING
  const M = 1_000_000
  return (
    (usage.input_tokens                  * price.input)       / M +
    (usage.output_tokens                 * price.output)      / M +
    (usage.cache_read_input_tokens       * price.cacheRead)   / M +
    (usage.cache_creation_input_tokens   * price.cacheCreate) / M
  )
}

// ─── Procesamiento de JSONL ───────────────────────────────────────────────────

interface FileOffsetEntry { offset: number; lastAccess: number }

const fileOffsets = new Map<string, FileOffsetEntry>()
const FILE_OFFSET_TTL = 30 * 60_000 // 30 minutos

function cleanupStaleOffsets() {
  const now = Date.now()
  for (const [key, entry] of fileOffsets) {
    if (now - entry.lastAccess > FILE_OFFSET_TTL) fileOffsets.delete(key)
  }
}

async function processJSONL(filePath: string): Promise<CostUpdate | null> {
  let fileContent: string
  try {
    fileContent = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }

  const currentSize = Buffer.byteLength(fileContent, 'utf8')
  const knownEntry  = fileOffsets.get(filePath)
  const knownOffset = knownEntry?.offset ?? 0
  if (currentSize < knownOffset) fileOffsets.set(filePath, { offset: 0, lastAccess: Date.now() })

  const totals: CostUpdate = {
    input_tokens: 0, output_tokens: 0,
    cache_read: 0, cache_creation: 0, cost_usd: 0,
    context_used: 0, context_window: 200_000
  }

  let lastInputUsd    = 0
  let lastOutputUsd   = 0
  let lastInputTokens  = 0
  let lastOutputTokens = 0
  let lastModel: string | undefined = undefined
  let firstTs: number | undefined = undefined

  for (const raw of fileContent.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue

      const msg   = obj.message
      const usage = msg?.usage as UsageEntry | undefined
      const model = (msg?.model as string) ?? undefined

      if (!usage) continue

      if (firstTs === undefined && obj.timestamp) {
        try { firstTs = new Date(obj.timestamp as string).getTime() } catch {}
      }

      totals.input_tokens   += usage.input_tokens                  ?? 0
      totals.output_tokens  += usage.output_tokens                 ?? 0
      totals.cache_read     += usage.cache_read_input_tokens       ?? 0
      totals.cache_creation += usage.cache_creation_input_tokens   ?? 0
      const resolvedModel = model ?? 'claude-sonnet-4-6'
      totals.cost_usd       += calcCost(resolvedModel, usage)

      totals.context_used   = (usage.input_tokens ?? 0)
                            + (usage.cache_read_input_tokens ?? 0)
                            + (usage.cache_creation_input_tokens ?? 0)
      totals.context_window = getContextWindow(resolvedModel)

      const price   = PRICING[resolvedModel] ?? DEFAULT_PRICING
      const M       = 1_000_000
      lastInputUsd     = ((usage.input_tokens                  ?? 0) * price.input       +
                          (usage.cache_read_input_tokens       ?? 0) * price.cacheRead   +
                          (usage.cache_creation_input_tokens   ?? 0) * price.cacheCreate) / M
      lastOutputUsd    = ((usage.output_tokens                 ?? 0) * price.output)     / M
      lastInputTokens  = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      lastOutputTokens = usage.output_tokens ?? 0
      lastModel        = model ?? lastModel
    } catch {}
  }

  if (lastInputUsd + lastOutputUsd > 0) {
    totals.lastEntry = {
      inputUsd:     lastInputUsd,
      outputUsd:    lastOutputUsd,
      totalUsd:     lastInputUsd + lastOutputUsd,
      inputTokens:  lastInputTokens,
      outputTokens: lastOutputTokens,
    }
  }
  totals.lastModel = lastModel
  totals.firstTs   = firstTs

  fileOffsets.set(filePath, { offset: currentSize, lastAccess: Date.now() })
  return totals
}

// ─── Todos los block costs históricos de una sesión ──────────────────────────

import type { BlockCostEntry } from './db'

const blockCostCache = new Map<string, { data: BlockCostEntry[]; ts: number }>()
const BLOCK_COST_TTL = 5 * 60_000

export async function getAllBlockCostsForSession(sessionId: string): Promise<BlockCostEntry[]> {
  const cached = blockCostCache.get(sessionId)
  if (cached && Date.now() - cached.ts < BLOCK_COST_TTL) return cached.data
  try {
    if (!fsSync.existsSync(PROJECTS_DIR)) return []
    const dirs = await fs.readdir(PROJECTS_DIR)
    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      try { await fs.access(filePath) } catch { continue }

      const result: BlockCostEntry[] = []
      let current: BlockCostEntry | null = null
      const content = await fs.readFile(filePath, 'utf8')

      for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        try {
          const obj = JSON.parse(line)

          if (obj.type === 'human' || obj.type === 'user') {
            const msgContent = obj.message?.content
            if (Array.isArray(msgContent) && msgContent[0]?.type === 'tool_result') continue
            const text = typeof msgContent === 'string' ? msgContent
              : Array.isArray(msgContent)
                ? ((msgContent as any[]).find((c: any) => c?.type === 'text')?.text ?? '')
                : ''
            if (text.includes('<system-reminder>') || text.includes('<command-name>')) continue
            current = { inputUsd: 0, outputUsd: 0, totalUsd: 0, inputTokens: 0, outputTokens: 0 }
            result.push(current)
          }

          if (obj.type === 'assistant' && current) {
            const usage = obj.message?.usage
            const model = (obj.message?.model as string) ?? 'claude-sonnet-4-6'
            if (!usage) continue
            const price    = PRICING[model] ?? DEFAULT_PRICING
            const M        = 1_000_000
            const inUsd    = ((usage.input_tokens                  ?? 0) * price.input       +
                              (usage.cache_read_input_tokens       ?? 0) * price.cacheRead   +
                              (usage.cache_creation_input_tokens   ?? 0) * price.cacheCreate) / M
            const outUsd   = ((usage.output_tokens ?? 0) * price.output) / M
            const inTok    = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            const outTok   = usage.output_tokens ?? 0
            current.inputUsd     += inUsd
            current.outputUsd    += outUsd
            current.totalUsd     += inUsd + outUsd
            current.inputTokens  += inTok
            current.outputTokens += outTok
          }
        } catch {}
      }

      const filtered = result.filter(b => b.totalUsd > 0)
      blockCostCache.set(sessionId, { data: filtered, ts: Date.now() })
      return filtered
    }
  } catch {}
  return []
}

// ─── Prompts del usuario por sesión ──────────────────────────────────────────

export interface SessionPrompt {
  index: number
  ts:    number
  text:  string
}

export async function getSessionPrompts(sessionId: string): Promise<SessionPrompt[]> {
  try {
    if (!fsSync.existsSync(PROJECTS_DIR)) return []
    const dirs = await fs.readdir(PROJECTS_DIR)
    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch { continue }

      const candidates = [
        path.join(dirPath, `${sessionId}.jsonl`),
      ]
      for (const file of candidates) {
        try { await fs.access(file) } catch { continue }
        const results: SessionPrompt[] = []
        const content = await fs.readFile(file, 'utf8')
        let index = 0
        for (const raw of content.split('\n')) {
          const line = raw.trim()
          if (!line) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'human' && obj.type !== 'user') continue
            const ts = obj.timestamp ? new Date(obj.timestamp as string).getTime() : 0
            if (!ts || isNaN(ts)) continue

            const msgContent = obj.message?.content
            let text = ''
            if (typeof msgContent === 'string') {
              text = msgContent
            } else if (Array.isArray(msgContent)) {
              const textBlocks = (msgContent as any[]).filter(c => c?.type === 'text')
              if (textBlocks.length === 0) continue
              text = textBlocks.map((c: any) => c.text ?? '').join('\n').trim()
            }

            if (
              text.includes('<command-name>') ||
              text.includes('<local-command-stdout>') ||
              text.includes('<system-reminder>') ||
              text.length === 0
            ) continue

            index++
            results.push({ index, ts, text })
          } catch {}
        }
        return results
      }
    }
  } catch {}
  return []
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(getClaudeDir(), 'projects')

export type CostUpdateCallback    = (sessionId: string, cost: CostUpdate) => void
export type CompactDetectedCallback = (sessionId: string) => void
export type SessionEndCallback = (sessionId: string) => void

const prevContextBySession = new Map<string, number>()

let watcher: chokidar.FSWatcher | null = null
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>()

let offsetCleanupInterval: ReturnType<typeof setInterval> | null = null

export function startEnricher(
  onUpdate: CostUpdateCallback,
  onCompact?: CompactDetectedCallback,
  onSessionEnd?: SessionEndCallback,
) {
  if (!fsSync.existsSync(PROJECTS_DIR)) {
    console.warn(`[enricher] Directory not found: ${PROJECTS_DIR}`)
    return
  }

  watcher = chokidar.watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    }
  })

  const handleFile = (filePath: string) => {
    const sessionId = path.basename(filePath, '.jsonl')
    if (!sessionId.includes('-') || sessionId.length < 10) return

    const existing = pendingFiles.get(filePath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      pendingFiles.delete(filePath)
      processJSONL(filePath).then(cost => {
        if (cost && cost.cost_usd >= 0) {
          const prev = prevContextBySession.get(sessionId)
          if (onCompact && prev !== undefined && prev > 140_000 && cost.context_used < prev * 0.5) {
            onCompact(sessionId)
          }
          prevContextBySession.set(sessionId, cost.context_used)
          onUpdate(sessionId, cost)
        }
      }).catch(err => console.error('[enricher] Error processing JSONL:', err))
    }, 100)
    pendingFiles.set(filePath, timer)
  }

  watcher.on('change', handleFile)
  watcher.on('add',    handleFile)

  offsetCleanupInterval = setInterval(cleanupStaleOffsets, 5 * 60_000)

  console.log(`[enricher] Watching ${PROJECTS_DIR}`)
}

export function stopEnricher() {
  if (watcher) { watcher.close(); watcher = null }
  if (offsetCleanupInterval) { clearInterval(offsetCleanupInterval); offsetCleanupInterval = null }
  for (const [, timer] of pendingFiles) clearTimeout(timer)
  pendingFiles.clear()
  fileOffsets.clear()
  prevContextBySession.clear()
  blockCostCache.clear()
  console.log('[enricher] Stopped')
}

export function cleanupSession(sessionId: string) {
  blockCostCache.delete(sessionId)
  prevContextBySession.delete(sessionId)
  for (const [key, entry] of fileOffsets) {
    if (key.includes(sessionId)) fileOffsets.delete(key)
  }
}

export async function processLatestForSession(sessionId: string, onUpdate: CostUpdateCallback): Promise<void> {
  try {
    if (!fsSync.existsSync(PROJECTS_DIR)) return
    const dirs = await fs.readdir(PROJECTS_DIR)
    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      try { await fs.access(filePath) } catch { continue }
      const cost = await processJSONL(filePath)
      if (cost && cost.cost_usd >= 0) onUpdate(sessionId, cost)
      return
    }
  } catch {}
}
