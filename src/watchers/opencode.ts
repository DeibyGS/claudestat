/**
 * opencode.ts — WatcherAdapter para OpenCode (poll-based, SQLite)
 *
 * OpenCode stores sessions in ~/.local/share/opencode/opencode.db (SQLite).
 * The session table has cost, token counts, model, and timestamps directly.
 * Uses PollableAdapter — no JSONL files, no chokidar.
 *
 * Schema v2 (OpenCode 2.x): sessions/messages live in `session_v2` /
 * `session_message`; tool parts are embedded in `session_message.data.content[]`
 * and per-step tokens live in `session_message.data.tokens` (v1 used a separate
 * `part` row of type 'step-finish'). The v1 tables remain read-only for old
 * installs — see oc-schema.ts.
 */

import fs   from 'fs'
import os   from 'os'
import path from 'path'
import { type PollableAdapter, type PollSession, type ParsedEvent, registerAdapter, clampGapMs } from './adapter'
import { getOpencodeDb } from '../paths'
import { getContextWindow, costFromPricing, type ModelPricing } from '../pricing'
import type { CostUpdate, BlockCostEntry, BillingKind, AssistantTurnRow, CompactionRow } from '../db'
import { dbOps } from '../db'
import { findProjectCwdForFile } from '../routes/helpers'
import { hasOcV2, ocSessionTable } from './oc-schema'
import { ocModelInfo } from './oc-catalog'
import { getCachedGitInfo } from '../cache/projects-cache'

function openDb() {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(getOpencodeDb(), { open: true })
}

/** Session `model` column: {"id":"gpt-6.1-sol","providerID":"openai",…}. */
function parseModelRef(raw: string | null): { id: string; providerId?: string } {
  if (!raw) return { id: 'unknown' }
  try {
    const obj = JSON.parse(raw) as { id?: string; providerID?: string }
    return { id: obj.id ?? 'unknown', providerId: obj.providerID }
  } catch {
    return { id: 'unknown' }
  }
}

/** Catalog window (else the Claude table / 200K fallback) and API prices for a session model. */
function catalogFor(db: Parameters<typeof ocModelInfo>[0], ref: { id: string; providerId?: string }) {
  const info = ocModelInfo(db, ref.providerId, ref.id)
  return { contextWindow: info.contextWindow ?? getContextWindow(ref.id), apiPricing: info.pricing }
}

interface StepFinishRow {
  total_tokens: number; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number
  cost: number | null   // real cost OpenCode recorded for this step (0 on a subscription)
  time_created: number
}

/**
 * OpenCode records the real cost: 0 means the provider bills a subscription
 * (or the model is free), never "unknown". The API price of the same tokens
 * comes from OC's catalog, so a $0 session is not re-estimated at Claude rates.
 */
function billingKind(realCost: number, apiPricing: ModelPricing | null): BillingKind {
  if (realCost > 0) return 'api'
  return apiPricing && apiPricing.input === 0 && apiPricing.output === 0 ? 'free' : 'subscription'
}

// Known OpenCode providers. Subscription-backed ones get the consumer product
// name; with a real cost they are the provider's pay-as-you-go API.
const PROVIDER_LABELS: Record<string, { subscription: string; api: string }> = {
  openai:    { subscription: 'ChatGPT',    api: 'OpenAI API' },
  anthropic: { subscription: 'Claude',     api: 'Anthropic API' },
}

/** Human label for an OC session's provider; unknown providers keep their id. */
export function ocProviderLabel(providerId: string | undefined, billing: BillingKind): string | undefined {
  if (!providerId) return undefined
  if (providerId.startsWith('opencode')) return 'OpenCode Go/Zen'   // opencode, opencode-go, …
  const known = PROVIDER_LABELS[providerId]
  if (!known) return providerId
  return billing === 'api' ? known.api : known.subscription
}

/**
 * time_busy / time_idle are the moments the session last went busy / idle, so
 * the newer one is the current state. A busy session never idled yet has a
 * null time_idle. Older schemas lack both columns → unknown.
 */
export function ocSessionState(busy: number | null, idle: number | null): 'working' | 'idle' | undefined {
  if (busy == null && idle == null) return undefined
  return busy != null && (idle == null || busy > idle) ? 'working' : 'idle'
}

// Branch is the directory's *current* branch, so it is only true for a session
// in use now — reading it for the backfill would stamp today's branch on old
// sessions (and run git for every directory at startup).
const OC_BRANCH_LIVE_MS = 10 * 60_000

/** Branch of a live session's directory (cached git call, best effort; detached HEAD → none). */
function ocBranch(dir: string | null | undefined, updatedAt: number): string | undefined {
  if (!dir || Date.now() - updatedAt > OC_BRANCH_LIVE_MS) return undefined
  const branch = getCachedGitInfo(dir)?.branch
  return branch && !branch.startsWith('(') ? branch : undefined
}

const STEP_FINISH_COLUMNS = `json_extract(data, '$.tokens.total') as total_tokens,
              json_extract(data, '$.tokens.input') as input_tokens,
              json_extract(data, '$.tokens.output') as output_tokens,
              json_extract(data, '$.tokens.cache.read') as cache_read,
              json_extract(data, '$.tokens.cache.write') as cache_write,
              json_extract(data, '$.cost') as cost,
              time_created`

// v2: cada assistant message con `tokens` es un paso (equivalente al
// 'step-finish' de v1). total_tokens replica la fórmula de v1
// (input + output + reasoning + cache.read + cache.write).
// `cost` es el coste real que OpenCode registró para el paso (0 con suscripción);
// el equivalente API se calcula aparte con el catálogo (ver billingKind).
const V2_STEP_COLUMNS = `COALESCE(json_extract(m.data, '$.tokens.input'), 0) as input_tokens,
              COALESCE(json_extract(m.data, '$.tokens.output'), 0) as output_tokens,
              COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0) as cache_read,
              COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) as cache_write,
              COALESCE(json_extract(m.data, '$.tokens.input'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.output'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) as total_tokens,
              json_extract(m.data, '$.cost') as cost,
              m.time_created`

// Un "paso" = step-finish (v1) o assistant message con tokens (v2).
function querySteps(
  db: ReturnType<typeof openDb>,
  sessionId: string,
  v2: boolean,
  dir: 'ASC' | 'DESC',
  limit?: number
): StepFinishRow[] {
  const lim = Number.isInteger(limit) ? ` LIMIT ${limit as number}` : ''
  if (v2) {
    return db.prepare(
      `SELECT ${V2_STEP_COLUMNS}
       FROM session_message m
       WHERE m.session_id = ?
       AND m.type = 'assistant'
       AND json_extract(m.data, '$.tokens') IS NOT NULL
       ORDER BY m.seq ${dir}${lim}`
    ).all(sessionId) as StepFinishRow[]
  }
  return db.prepare(
    `SELECT ${STEP_FINISH_COLUMNS}
     FROM part
     WHERE session_id = ?
     AND json_extract(data, '$.type') = 'step-finish'
     ORDER BY time_created ${dir}${lim}`
  ).all(sessionId) as StepFinishRow[]
}

// pollSessions() corre cada 3s para toda sesión con time_updated reciente — ese timestamp
// puede avanzar por escrituras intermedias (tool calls) sin que el último step-finish haya
// cambiado. Sin este guard, el mismo step-finish se re-emite como block_cost en cada tick
// mientras el turno está en curso, y como block_cost de OC ahora empuja directo a blockCosts
// (no espera un Stop que OC no tiene), eso duplicaba bloques idénticos en el Live tab.
const lastEmittedStepFinishTs = new Map<string, number>()

// Un 'step-finish' de OC ya es un turno completo (a diferencia de CC, que fragmenta
// un turno en varias llamadas API) — se usa tanto para el bloque en vivo (pollSessions,
// solo el último) como para el historial completo (getAllStepFinishBlocksForSession).
function stepFinishRowToBlockCost(row: StepFinishRow, contextWindow: number, apiPricing: ModelPricing | null): BlockCostEntry | null {
  const usage = {
    input_tokens: row.input_tokens ?? 0, output_tokens: row.output_tokens ?? 0,
    cache_read_input_tokens: row.cache_read ?? 0, cache_creation_input_tokens: row.cache_write ?? 0,
  }
  if (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens && !usage.cache_creation_input_tokens) return null
  // Real step cost (0 on a subscription); the 70/30 split is a display approximation
  const price = row.cost && row.cost > 0 ? row.cost : 0
  return {
    inputUsd:       price * 0.7,
    outputUsd:      price * 0.3,
    totalUsd:       price,
    inputTokens:    (row.input_tokens ?? 0) + (row.cache_read ?? 0) + (row.cache_write ?? 0),
    outputTokens:   row.output_tokens ?? 0,
    cacheRead:      row.cache_read ?? 0,
    cacheCreate:    row.cache_write ?? 0,
    context_used:   row.total_tokens,
    context_window: contextWindow,
    apiEquivalentUsd: apiPricing ? costFromPricing(apiPricing, usage) : null,
  }
}

const HOME = os.homedir()

function inferProjectFromParts(db: ReturnType<typeof openDb> | null, sessionId: string): string | undefined {
  if (!db) return undefined
  const v2 = hasOcV2(db)

  const parts = v2
    ? db.prepare(`
        SELECT je.value AS data
        FROM session_message m, json_each(m.data, '$.content') je
        WHERE m.session_id = ?
        AND json_extract(je.value, '$.type') = 'tool'
        AND json_extract(je.value, '$.name') IN ('read', 'write', 'edit', 'glob', 'grep')
        ORDER BY m.seq DESC
        LIMIT 30
      `).all(sessionId) as Array<{ data: string }>
    : db.prepare(`
        SELECT p.data FROM part p
        JOIN message m ON p.message_id = m.id
        WHERE m.session_id = ?
        AND json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') IN ('read', 'write', 'edit', 'glob', 'grep')
        ORDER BY p.time_created DESC
        LIMIT 30
      `).all(sessionId) as Array<{ data: string }>

  const roots = new Map<string, number>()
  for (const { data } of parts) {
    try {
      const input = JSON.parse(data).state?.input
      if (!input) continue
      const filePath = input.filePath || input.path || input.file_path
      if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) continue
      const root = findProjectCwdForFile(filePath)
      if (root) roots.set(root, (roots.get(root) ?? 0) + 1)
    } catch {}
  }

  if (roots.size === 0) return undefined
  return [...roots.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

interface ToolEntry { toolName: string; ts: number; externalId: string }

function importToolEvents(ocDb: ReturnType<typeof openDb>, sessionId: string, targetSessionId?: string): void {
  const v2 = hasOcV2(ocDb)

  // v2: los tool parts viven dentro de session_message.data.content[] con
  // {type:'tool', id, name, state, time:{created,ran,completed}}.
  const parts = v2
    ? ocDb.prepare(`
        SELECT m.id AS message_id, je.key AS part_index, je.value AS data
        FROM session_message m, json_each(m.data, '$.content') je
        WHERE m.session_id = ?
        AND json_extract(je.value, '$.type') = 'tool'
        AND json_extract(je.value, '$.state') IS NOT NULL
        ORDER BY m.seq ASC
      `).all(sessionId) as Array<{ message_id: string; part_index: number; data: string }>
    : ocDb.prepare(`
        SELECT p.id, p.data, p.time_created
        FROM part p
        JOIN message m ON p.message_id = m.id
        WHERE m.session_id = ?
        AND json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state') IS NOT NULL
        ORDER BY p.time_created ASC
      `).all(sessionId) as Array<{ id: string; data: string; time_created: number }>

  const destId = targetSessionId ?? sessionId

  const entries: ToolEntry[] = []
  for (const part of parts) {
    try {
      const parsed = JSON.parse(part.data) as {
        tool?: string; name?: string
        time?: { created?: number }
        state?: unknown
      }
      const toolName = v2 ? parsed.name : parsed.tool
      if (!toolName) continue
      const ts = v2 ? (parsed.time?.created ?? 0) : (part as { time_created: number }).time_created
      if (!ts) continue
      const externalId = v2
        ? `${(part as { message_id: string }).message_id}#${(part as { part_index: number }).part_index}`
        : (part as { id: string }).id
      entries.push({ toolName, ts, externalId })
    } catch {}
  }

  for (let i = 0; i < entries.length; i++) {
    const durationMs = i < entries.length - 1 ? Math.max(0, entries[i + 1].ts - entries[i].ts) : 0
    dbOps.insertOcEvent(destId, entries[i].toolName, entries[i].ts, durationMs, entries[i].externalId)
  }
}

// ─── Session grouping: merge consecutive OC sessions from same conversation ────
// OpenCode creates a new session row per prompt, even within the same conversation.
// We group sessions by directory + close time_created (<60s apart) into one.

function groupOcSessions<R extends {
    id: string; directory: string | null; model: string | null
    cost: number; tokens_input: number; tokens_output: number
    tokens_cache_read: number; tokens_cache_write: number
    time_created: number; time_updated: number
    time_busy?: number | null; time_idle?: number | null
  }>(rows: R[]): R[] {
  const sorted = [...rows].sort((a, b) => a.time_created - b.time_created)
  const groups: Map<string, typeof rows> = new Map()
  const grouped = new Set<string>()
  const MAX_GROUP_SPAN_MS = 30 * 60 * 1000

  for (let i = 0; i < sorted.length; i++) {
    if (grouped.has(sorted[i].id)) continue
    const group: typeof rows = [sorted[i]]
    grouped.add(sorted[i].id)
    let lastOtherDirCreated = 0

    for (let j = i + 1; j < sorted.length; j++) {
      const prev = group[group.length - 1]
      const curr = sorted[j]
      if (grouped.has(curr.id)) continue

      if (curr.directory !== prev.directory) {
        lastOtherDirCreated = curr.time_created
        continue
      }

      if (lastOtherDirCreated > prev.time_created) break

      const gap = curr.time_created - prev.time_created
      if (gap > 60_000) break
      if (curr.time_created < prev.time_updated) continue

      const groupSpan = curr.time_created - group[0].time_created
      if (groupSpan > MAX_GROUP_SPAN_MS) break

      group.push(curr)
      grouped.add(curr.id)
    }

    groups.set(group[0].id, group)
  }

  // Flatten: return only master (first) rows, with aggregated cost/tokens
  return [...groups.values()].map(group => {
    const master = { ...group[0] }
    for (let k = 1; k < group.length; k++) {
      const s = group[k]
      master.cost              += s.cost
      master.tokens_input      += s.tokens_input
      master.tokens_output     += s.tokens_output
      master.tokens_cache_read += s.tokens_cache_read
      master.tokens_cache_write+= s.tokens_cache_write
      if (s.time_updated > master.time_updated) master.time_updated = s.time_updated
      // The chain's state is its newest busy/idle transition, whichever row has it
      if ((s.time_busy ?? 0) > (master.time_busy ?? 0)) master.time_busy = s.time_busy
      if ((s.time_idle ?? 0) > (master.time_idle ?? 0)) master.time_idle = s.time_idle
    }
    return master
  })
}

export const opencodeAdapter: PollableAdapter = {
  name: 'opencode',
  label: 'OpenCode',
  get shortName() { return 'OC' },

  detect(): boolean {
    try {
      return fs.existsSync(getOpencodeDb())
    } catch {
      return false
    }
  },

  getWatchPaths(): string[] {
    return []
  },

  parseEvent(_raw: string, _filePath: string): ParsedEvent | null {
    return null
  },

  async getSessionCost(_filePath: string): Promise<CostUpdate | null> {
    return null
  },

  async pollSessions(since: number): Promise<PollSession[]> {
    let db: ReturnType<typeof openDb> | null = null
    try {
      db = openDb()
      const v2 = hasOcV2(db)
      const table = ocSessionTable(db)
      const cols  = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name))
      const orNull = (c: string) => cols.has(c) ? c : `NULL as ${c}`
      const rows = db.prepare(
        `SELECT id, directory, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                time_created, time_updated, ${orNull('time_busy')}, ${orNull('time_idle')}
         FROM ${table}
         WHERE time_updated >= ?
         AND time_archived IS NULL`
      ).all(since) as Array<{
        id: string
        directory: string | null
        model: string | null
        cost: number
        tokens_input: number
        tokens_output: number
        tokens_cache_read: number
        tokens_cache_write: number
        time_created: number
        time_updated: number
        time_busy:    number | null
        time_idle:    number | null
      }>

      const grouped = groupOcSessions(rows)
      // Build master lookup: original session id → master session id
      const masterMap = new Map<string, string>()
      for (let i = 0; i < rows.length; i++) {
        const masterId = grouped.find(g => g.id === rows[i].id)?.id
          ?? rows[i].id
        masterMap.set(rows[i].id, masterId)
      }

      // Import tool events into the master session ID
      for (const s of rows) {
        const masterId = masterMap.get(s.id) ?? s.id
        try { importToolEvents(db, s.id, masterId) } catch {}
      }

      return grouped.map(row => {
        const modelRef = parseModelRef(row.model)
        const modelId = modelRef.id
        const { contextWindow, apiPricing } = catalogFor(db!, modelRef)
        const dir = row.directory
        const shouldInfer = !dir || dir === HOME || dir.split(/[/\\]/).filter(Boolean).length <= 3
        const inferred = shouldInfer ? inferProjectFromParts(db, row.id) : undefined
        const projectCwd = inferred ?? dir ?? undefined

        const realCost = row.cost > 0 ? row.cost : 0
        const billing = billingKind(realCost, apiPricing)
        const apiEquivalentUsd = apiPricing ? costFromPricing(apiPricing, {
          input_tokens: row.tokens_input, output_tokens: row.tokens_output,
          cache_read_input_tokens: row.tokens_cache_read, cache_creation_input_tokens: row.tokens_cache_write,
        }) : null

        // Query latest step for actual context usage (step-finish en v1,
        // último assistant message con tokens en v2)
        let contextUsed = row.tokens_input + row.tokens_cache_read + row.tokens_cache_write + row.tokens_output
        let lastEntry: CostUpdate['lastEntry'] = undefined
        try {
          if (db) {
            const steps = querySteps(db, row.id, v2, 'DESC', 1)
            const stepFinish = steps[0]

            if (stepFinish && stepFinish.total_tokens) {
              contextUsed = stepFinish.total_tokens
              if (stepFinish.time_created !== lastEmittedStepFinishTs.get(row.id)) {
                lastEmittedStepFinishTs.set(row.id, stepFinish.time_created)
                lastEntry = stepFinishRowToBlockCost(stepFinish, contextWindow, apiPricing) ?? undefined
              }
            }
          }
        } catch { /* ignore — table may not exist */ }

        return {
          sessionId: row.id,
          cwd: projectCwd,
          cost: {
            input_tokens: row.tokens_input,
            output_tokens: row.tokens_output,
            cache_read: row.tokens_cache_read,
            cache_creation: row.tokens_cache_write,
            cost_usd: realCost,
            billing,
            apiEquivalentUsd,
            provider: ocProviderLabel(modelRef.providerId, billing),
            ocState:   ocSessionState(row.time_busy, row.time_idle),
            gitBranch: ocBranch(projectCwd, row.time_updated),
            context_used: contextUsed,
            context_window: contextWindow,
            lastModel: modelId,
            firstTs: row.time_created,
            lastTs:  row.time_updated,
            lastEntry,
          } satisfies CostUpdate,
        }
      })
    } catch {
      return []
    } finally {
      db?.close()
    }
  },
}

// Cache del historial de bloques por sesión OC — mismo criterio que
// blockCostCache en claude-code.ts: sin esto, cada reconexión SSE (/stream)
// vuelve a escanear TODOS los step-finish de la sesión desde cero.
const stepFinishBlocksCache = new Map<string, { data: BlockCostEntry[]; ts: number }>()
const STEP_FINISH_CACHE_TTL = 5 * 60_000

// Historial de bloques para OC: un entry por cada 'step-finish' registrado —
// mismo criterio que pollSessions() usa para el bloque en vivo, pero sobre
// TODOS los steps de la sesión en vez de solo el último. Permite que el
// Live tab arranque con el historial completo de Cost/block, no solo el
// primer bloque que llegue después de conectarse.
export async function getAllStepFinishBlocksForSession(sessionId: string): Promise<BlockCostEntry[]> {
  const cached = stepFinishBlocksCache.get(sessionId)
  if (cached && Date.now() - cached.ts < STEP_FINISH_CACHE_TTL) return cached.data

  let db: ReturnType<typeof openDb> | null = null
  try {
    db = openDb()
    const v2 = hasOcV2(db)
    const sessionRow = db.prepare(`SELECT model FROM ${ocSessionTable(db)} WHERE id = ?`).get(sessionId) as { model: string | null } | undefined
    const modelRef = parseModelRef(sessionRow?.model ?? null)
    const { contextWindow, apiPricing } = catalogFor(db, modelRef)

    const rows = querySteps(db, sessionId, v2, 'ASC')

    const blocks = rows
      .filter(r => r.total_tokens)
      .map(r => stepFinishRowToBlockCost(r, contextWindow, apiPricing))
      .filter((b): b is BlockCostEntry => b !== null)

    stepFinishBlocksCache.set(sessionId, { data: blocks, ts: Date.now() })
    return blocks
  } catch {
    return cached?.data ?? []
  } finally {
    db?.close()
  }
}

/**
 * S5/S6 — per-turn rows for the live focus, built only from what OC's `session_message`
 * (v2) actually records: real reasoning tokens, `type='compaction'` rows (trigger = its
 * `reason`, 'auto'|'manual'), and step timings (`time.created/.completed`, plus the gap to
 * the next step as tool time). No file-diff data exists anywhere in OC's schema, so
 * lines_added/lines_removed stay undefined (stored as NULL, rendered "—") — never 0, which
 * would wrongly claim "no lines changed". v1 installs have no such per-message JSON, so
 * they get no turns rather than guessed ones.
 */
export async function extractOcTurns(sessionId: string): Promise<{
  turns: AssistantTurnRow[]; compactions: CompactionRow[]; avg_output_chars: number; error_block_count: number
} | null> {
  let db: ReturnType<typeof openDb> | null = null
  try {
    db = openDb()
    if (!hasOcV2(db)) return { turns: [], compactions: [], avg_output_chars: 0, error_block_count: 0 }

    const rows = db.prepare(`
      SELECT type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq ASC
    `).all(sessionId) as Array<{ type: string; time_created: number; data: string }>

    const compactions: CompactionRow[] = []
    const steps: Array<{ ts: number; parsed: any }> = []

    for (const row of rows) {
      if (row.type === 'compaction') {
        try {
          const d = JSON.parse(row.data)
          compactions.push({ ts: row.time_created, trigger: typeof d.reason === 'string' ? d.reason : undefined })
        } catch {}
        continue
      }
      if (row.type !== 'assistant') continue
      try {
        const d = JSON.parse(row.data)
        if (d.tokens) steps.push({ ts: row.time_created, parsed: d })
      } catch {}
    }

    const turns: AssistantTurnRow[] = steps.map((step, i) => {
      const d = step.parsed
      const tokens: Record<string, any> = d.tokens ?? {}
      const time:   Record<string, any> = d.time   ?? {}
      const created   = typeof time.created   === 'number' ? time.created   : undefined
      const completed = typeof time.completed === 'number' ? time.completed : undefined
      const apiMs  = clampGapMs(created, completed)
      const nextCreated = steps[i + 1]?.parsed?.time?.created
      const toolMs = clampGapMs(completed, typeof nextCreated === 'number' ? nextCreated : undefined)

      const content: any[] = Array.isArray(d.content) ? d.content : []
      const toolCalls  = content.filter(c => c?.type === 'tool' && typeof c.name === 'string').map(c => c.name as string)
      const textParts  = content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text as string)
      const reasoning  = tokens.reasoning
      const cost       = d.cost

      return {
        turn_index:    i,
        ts:            created ?? step.ts,
        text_preview:  textParts.join('\n').slice(0, 500),
        tool_calls:    toolCalls,
        error_count:   0,
        output_chars:  textParts.reduce((sum, t) => sum + t.length, 0),
        context_used:  (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0),
        model:         typeof d.model?.id === 'string' ? d.model.id : undefined,
        cost_usd:      typeof cost === 'number' ? cost : null,
        priced:        typeof cost === 'number',
        input_tokens:  tokens.input, output_tokens: tokens.output,
        cache_read:    tokens.cache?.read, cache_creation: tokens.cache?.write,
        lines_added:   undefined, lines_removed: undefined,
        api_ms: apiMs, tool_ms: toolMs,
        // Real reasoning-token count, not an estimate — the UI must not prefix it with "≈".
        thinking_tokens_est: typeof reasoning === 'number' && reasoning > 0 ? reasoning : undefined,
      }
    })

    const totalOutputChars = turns.reduce((sum, t) => sum + t.output_chars, 0)
    const avg_output_chars = turns.length > 0 ? Math.round(totalOutputChars / turns.length) : 0
    return { turns, compactions, avg_output_chars, error_block_count: 0 }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

export function isSessionArchived(sessionId: string): boolean {
  try {
    const db = openDb()
    const row = db.prepare(`SELECT time_archived FROM ${ocSessionTable(db)} WHERE id = ?`).get(sessionId) as { time_archived: number | null } | undefined
    db.close()
    return row === undefined || row.time_archived !== null
  } catch {
    return false
  }
}

registerAdapter(opencodeAdapter)
