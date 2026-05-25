/**
 * claude-code.ts — WatcherAdapter para Claude Code
 *
 * Claude Code escribe trazas JSONL en ~/.claude/projects/{hash}/{session-id}.jsonl
 * Cada línea "assistant" contiene usage tokens y modelo.
 */

import path from 'path'
import fs   from 'fs/promises'
import fsSync from 'fs'
import { type WatcherAdapter, type ParsedEvent, registerAdapter } from './adapter'
import { getClaudeDir } from '../paths'
import { calcCost, PRICING, DEFAULT_PRICING } from '../pricing'
import type { CostUpdate } from '../db'
import type { BlockCostEntry } from '../db'

const PROJECTS_DIR = path.join(getClaudeDir(), 'projects')

interface UsageEntry {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5':  200_000,
}

export function getContextWindow(model: string): number {
  return KNOWN_CONTEXT_WINDOWS[model] ?? 200_000
}

const fileOffsets = new Map<string, { offset: number; lastAccess: number }>()
const FILE_OFFSET_TTL = 30 * 60_000

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
  let lastModel: string | undefined
  let firstTs: number | undefined

  for (const raw of fileContent.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue

      const msg = obj.message
      if (!msg?.usage) continue

      const usage = msg.usage as UsageEntry
      const model = msg.model ?? 'claude-sonnet-4-6'

      if (firstTs === undefined && obj.timestamp) {
        try { firstTs = new Date(obj.timestamp as string).getTime() } catch { /* ignore */ }
      }

      totals.input_tokens   += usage.input_tokens                  ?? 0
      totals.output_tokens  += usage.output_tokens                 ?? 0
      totals.cache_read     += usage.cache_read_input_tokens       ?? 0
      totals.cache_creation += usage.cache_creation_input_tokens   ?? 0
      totals.cost_usd       += calcCost(model, usage)

      totals.context_used   = (usage.input_tokens ?? 0)
                            + (usage.cache_read_input_tokens ?? 0)
                            + (usage.cache_creation_input_tokens ?? 0)
      totals.context_window = getContextWindow(model)

      const price   = PRICING[model] ?? DEFAULT_PRICING
      const M       = 1_000_000
      lastInputUsd     = ((usage.input_tokens                  ?? 0) * price.input       +
                          (usage.cache_read_input_tokens       ?? 0) * price.cacheRead   +
                          (usage.cache_creation_input_tokens   ?? 0) * price.cacheCreate) / M
      lastOutputUsd    = ((usage.output_tokens                 ?? 0) * price.output)     / M
      lastInputTokens  = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      lastOutputTokens = usage.output_tokens ?? 0
      lastModel        = model ?? lastModel
    } catch { /* skip malformed lines */ }
  }

  if (lastInputUsd + lastOutputUsd > 0) {
    totals.lastEntry = {
      inputUsd: lastInputUsd, outputUsd: lastOutputUsd,
      totalUsd: lastInputUsd + lastOutputUsd,
      inputTokens: lastInputTokens, outputTokens: lastOutputTokens,
    }
  }
  totals.lastModel = lastModel
  totals.firstTs   = firstTs

  fileOffsets.set(filePath, { offset: currentSize, lastAccess: Date.now() })
  return totals
}

export const claudeCodeAdapter: WatcherAdapter = {
  name: 'claude-code',
  label: 'Claude Code',
  get shortName() { return 'CC' },

  detect(): boolean {
    try {
      return fsSync.existsSync(PROJECTS_DIR)
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${PROJECTS_DIR}/**/*.jsonl`]
  },

  parseEvent(raw: string, _filePath: string): ParsedEvent | null {
    try {
      const obj = JSON.parse(raw)
      if (!obj.type || !obj.session_id) return null
      return {
        sessionId: obj.session_id,
        type: obj.type,
        toolName: obj.tool_name,
        toolInput: obj.tool_input ? JSON.stringify(obj.tool_input) : undefined,
        ts: obj.ts ?? obj.timestamp ?? Date.now(),
        cwd: obj.cwd,
      }
    } catch {
      return null
    }
  },

  async getSessionCost(filePath: string): Promise<CostUpdate | null> {
    return processJSONL(filePath)
  },
}

setInterval(cleanupStaleOffsets, 5 * 60_000).unref()
registerAdapter(claudeCodeAdapter)

// ─── Session-level utilities (used by routes/stream and routes/misc) ───────────

const blockCostCache = new Map<string, { data: BlockCostEntry[]; ts: number }>()
const costCacheLocks = new Map<string, boolean>()
const BLOCK_COST_TTL = 5 * 60_000

export async function getAllBlockCostsForSession(sessionId: string): Promise<BlockCostEntry[]> {
  const cached = blockCostCache.get(sessionId)
  if (cached && Date.now() - cached.ts < BLOCK_COST_TTL) return cached.data
  if (costCacheLocks.get(sessionId)) return cached?.data ?? []
  costCacheLocks.set(sessionId, true)
  try {
    if (!fsSync.existsSync(PROJECTS_DIR)) return []
    const dirs = await fs.readdir(PROJECTS_DIR)
    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try { const stat = await fs.stat(dirPath); if (!stat.isDirectory()) continue } catch { continue }
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
            const price = PRICING[model] ?? DEFAULT_PRICING
            const M = 1_000_000
            const inUsd = ((usage.input_tokens ?? 0) * price.input + (usage.cache_read_input_tokens ?? 0) * price.cacheRead + (usage.cache_creation_input_tokens ?? 0) * price.cacheCreate) / M
            const outUsd = ((usage.output_tokens ?? 0) * price.output) / M
            const inTok = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            const outTok = usage.output_tokens ?? 0
            current.inputUsd += inUsd; current.outputUsd += outUsd; current.totalUsd += inUsd + outUsd
            current.inputTokens += inTok; current.outputTokens += outTok
          }
        } catch { /* skip malformed */ }
      }
      const filtered = result.filter(b => b.totalUsd > 0)
      blockCostCache.set(sessionId, { data: filtered, ts: Date.now() })
      return filtered
    }
  } catch (e) { console.warn('[enricher] Error calculating block costs:', e) }
  finally { costCacheLocks.delete(sessionId) }
  return cached?.data ?? []
}

export interface SessionPrompt {
  index: number; ts: number; text: string
}

export async function getSessionPrompts(sessionId: string): Promise<SessionPrompt[]> {
  try {
    if (!fsSync.existsSync(PROJECTS_DIR)) return []
    const dirs = await fs.readdir(PROJECTS_DIR)
    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try { const stat = await fs.stat(dirPath); if (!stat.isDirectory()) continue } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      try { await fs.access(filePath) } catch { continue }
      const results: SessionPrompt[] = []
      const content = await fs.readFile(filePath, 'utf8')
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
          if (typeof msgContent === 'string') text = msgContent
          else if (Array.isArray(msgContent)) {
            const textBlocks = (msgContent as any[]).filter(c => c?.type === 'text')
            if (textBlocks.length === 0) continue
            text = textBlocks.map((c: any) => c.text ?? '').join('\n').trim()
          }
          if (text.includes('<command-name>') || text.includes('<local-command-stdout>') || text.includes('<system-reminder>') || text.length === 0) continue
          index++; results.push({ index, ts, text })
        } catch { /* skip */ }
      }
      return results
    }
  } catch { /* skip */ }
  return []
}
