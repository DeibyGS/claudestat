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
import { calcCost, getContextWindow, PRICING, DEFAULT_PRICING } from '../pricing'
import type { CostUpdate } from '../db'
import type { BlockCostEntry } from '../db'

function projectsDir(): string { return path.join(getClaudeDir(), 'projects') }

interface UsageEntry {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

interface FileState {
  offset:     number
  lastAccess: number
  totals:     CostUpdate
}

const fileOffsets = new Map<string, FileState>()
const FILE_OFFSET_TTL = 30 * 60_000

function cleanupStaleOffsets() {
  const now = Date.now()
  for (const [key, entry] of fileOffsets) {
    if (now - entry.lastAccess > FILE_OFFSET_TTL) fileOffsets.delete(key)
  }
}

async function processJSONL(filePath: string): Promise<CostUpdate | null> {
  let fd: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    fd = await fs.open(filePath, 'r')
    const currentSize = (await fd.stat()).size

    // File was truncated (e.g., /compact) — drop cached state and re-read from start
    let state = fileOffsets.get(filePath)
    if (state && currentSize < state.offset) {
      fileOffsets.delete(filePath)
      state = undefined
    }

    const fromByte = state?.offset ?? 0

    // Nothing new — return cached totals without lastEntry to avoid duplicate SSE
    if (currentSize === fromByte && state) return { ...state.totals, lastEntry: undefined }

    // Read only the new bytes since last processed offset
    const buf = Buffer.alloc(currentSize - fromByte)
    await fd.read(buf, 0, buf.length, fromByte)
    const newContent = buf.toString('utf8')

    // Accumulate on top of previous totals (or start from zero on first read)
    const prevTotals = state?.totals
    const totals: CostUpdate = {
      input_tokens:   prevTotals?.input_tokens   ?? 0,
      output_tokens:  prevTotals?.output_tokens  ?? 0,
      cache_read:     prevTotals?.cache_read      ?? 0,
      cache_creation: prevTotals?.cache_creation  ?? 0,
      cost_usd:       prevTotals?.cost_usd        ?? 0,
      context_used:   prevTotals?.context_used    ?? 0,
      context_window: prevTotals?.context_window  ?? 200_000,
      firstTs:        prevTotals?.firstTs,
      lastModel:      prevTotals?.lastModel,
    }

    let lastInputUsd     = 0
    let lastOutputUsd    = 0
    let lastInputTokens  = 0
    let lastOutputTokens = 0
    let lastCacheRead    = 0
    let lastCacheCreate  = 0
    let hasNewAssistant  = false

    for (const raw of newContent.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== 'assistant') continue
        const msg = obj.message
        if (!msg?.usage) continue

        const usage = msg.usage as UsageEntry
        const model = msg.model ?? 'claude-sonnet-4-6'
        hasNewAssistant = true

        if (obj.timestamp) {
          try {
            const ts = new Date(obj.timestamp as string).getTime()
            if (totals.firstTs === undefined) totals.firstTs = ts
            totals.lastTs = ts
          } catch { /* ignore */ }
        }

        totals.input_tokens   += usage.input_tokens                ?? 0
        totals.output_tokens  += usage.output_tokens               ?? 0
        totals.cache_read     += usage.cache_read_input_tokens      ?? 0
        totals.cache_creation += usage.cache_creation_input_tokens  ?? 0
        totals.cost_usd       += calcCost(model, usage)
        totals.context_used    = (usage.input_tokens                ?? 0)
                               + (usage.cache_read_input_tokens     ?? 0)
                               + (usage.cache_creation_input_tokens ?? 0)
        totals.context_window  = getContextWindow(model)

        const price = PRICING[model] ?? DEFAULT_PRICING
        const M     = 1_000_000
        const inp   = usage.input_tokens ?? 0
        const cacheRead = usage.cache_read_input_tokens ?? 0
        const cacheCreate = usage.cache_creation_input_tokens ?? 0
        const out = usage.output_tokens ?? 0
        lastInputUsd     = (inp * price.input + cacheRead * price.cacheRead + cacheCreate * price.cacheCreate) / M
        lastOutputUsd    = out * price.output / M
        lastInputTokens  = inp + cacheRead + cacheCreate
        lastOutputTokens = out
        lastCacheRead    = cacheRead
        lastCacheCreate  = cacheCreate
        totals.lastModel = model
      } catch { /* skip malformed lines */ }
    }

    // lastEntry only when there are new API calls — drives the block_cost SSE event
    if (hasNewAssistant && lastInputUsd + lastOutputUsd > 0) {
      const totalUsd = lastInputUsd + lastOutputUsd
      totals.lastEntry = {
        inputUsd: lastInputUsd, outputUsd: lastOutputUsd,
        totalUsd,
        inputTokens: lastInputTokens, outputTokens: lastOutputTokens,
        cacheRead: lastCacheRead, cacheCreate: lastCacheCreate,
      }
    }

    fileOffsets.set(filePath, { offset: currentSize, lastAccess: Date.now(), totals })
    return totals
  } catch {
    return null
  } finally {
    await fd?.close()
  }
}

export const claudeCodeAdapter: WatcherAdapter = {
  name: 'claude-code',
  label: 'Claude Code',
  get shortName() { return 'CC' },

  detect(): boolean {
    try {
      return fsSync.existsSync(projectsDir())
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return [`${projectsDir()}/**/*.jsonl`]
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

// ─── Semantic enrichment ───────────────────────────────────────────────────────

export interface AssistantTurn {
  turn_index: number
  ts?: number
  text_preview: string
  tool_calls: string[]
  error_count: number
  output_chars: number
  context_used: number
}

export interface SemanticData {
  turns: AssistantTurn[]
  avg_output_chars: number
  error_block_count: number
}

export async function findJSONLForSession(sessionId: string): Promise<string | null> {
  try {
    if (!fsSync.existsSync(projectsDir())) return null
    const dirs = await fs.readdir(projectsDir())
    for (const dir of dirs) {
      const dirPath = path.join(projectsDir(), dir)
      try { const stat = await fs.stat(dirPath); if (!stat.isDirectory()) continue } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      try { await fs.access(filePath); return filePath } catch { continue }
    }
  } catch { /* ignore */ }
  return null
}

export async function extractSemanticData(filePath: string): Promise<SemanticData | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const turns: AssistantTurn[] = []
    let pendingTurn: AssistantTurn | null = null
    let totalErrorBlocks = 0
    let turnIndex = 0

    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      try {
        const obj = JSON.parse(line)

        if (obj.type === 'assistant') {
          if (pendingTurn) turns.push(pendingTurn)

          const msgContent = obj.message?.content
          if (!Array.isArray(msgContent)) { pendingTurn = null; continue }

          let outputChars = 0
          const textParts: string[] = []
          const toolCalls: string[] = []

          for (const block of msgContent as any[]) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              outputChars += block.text.length
              textParts.push(block.text)
            } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
              toolCalls.push(block.name)
            }
          }

          let ts: number | undefined
          if (obj.timestamp) {
            try { ts = new Date(obj.timestamp as string).getTime() } catch { /* ignore */ }
          }

          const usage = obj.message?.usage
          const contextUsed = usage
            ? ((usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0))
            : 0

          pendingTurn = {
            turn_index:   turnIndex++,
            ts,
            text_preview: textParts.join('\n').slice(0, 500),
            tool_calls:   toolCalls,
            error_count:  0,
            output_chars: outputChars,
            context_used: contextUsed,
          }
        } else if ((obj.type === 'human' || obj.type === 'user') && pendingTurn) {
          const msgContent = obj.message?.content
          if (!Array.isArray(msgContent)) continue
          for (const block of msgContent as any[]) {
            if (block?.type === 'tool_result' && block.is_error === true) {
              pendingTurn.error_count++
              totalErrorBlocks++
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }

    if (pendingTurn) turns.push(pendingTurn)

    const totalOutputChars = turns.reduce((sum, t) => sum + t.output_chars, 0)
    const avg_output_chars = turns.length > 0 ? Math.round(totalOutputChars / turns.length) : 0

    return { turns, avg_output_chars, error_block_count: totalErrorBlocks }
  } catch {
    return null
  }
}

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
    if (!fsSync.existsSync(projectsDir())) return []
    const dirs = await fs.readdir(projectsDir())
    for (const dir of dirs) {
      const dirPath = path.join(projectsDir(), dir)
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
    if (!fsSync.existsSync(projectsDir())) return []
    const dirs = await fs.readdir(projectsDir())
    for (const dir of dirs) {
      const dirPath = path.join(projectsDir(), dir)
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
