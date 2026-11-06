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
import { type PollableAdapter, type PollSession, type ParsedEvent, registerAdapter } from './adapter'
import { getOpencodeDb } from '../paths'
import { getContextWindow, calcCost } from '../pricing'
import type { CostUpdate, BlockCostEntry } from '../db'
import { dbOps } from '../db'
import { findProjectCwdForFile } from '../routes/helpers'
import { hasOcV2, ocSessionTable } from './oc-schema'

function openDb() {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(getOpencodeDb(), { open: true })
}

function parseModel(raw: string | null): string {
  if (!raw) return 'unknown'
  try {
    const obj = JSON.parse(raw) as { id?: string }
    return obj.id ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

interface StepFinishRow {
  total_tokens: number; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number
  time_created: number
}

const STEP_FINISH_COLUMNS = `json_extract(data, '$.tokens.total') as total_tokens,
              json_extract(data, '$.tokens.input') as input_tokens,
              json_extract(data, '$.tokens.output') as output_tokens,
              json_extract(data, '$.tokens.cache.read') as cache_read,
              json_extract(data, '$.tokens.cache.write') as cache_write,
              time_created`

// v2: cada assistant message con `tokens` es un paso (equivalente al
// 'step-finish' de v1). total_tokens replica la fórmula de v1
// (input + output + reasoning + cache.read + cache.write).
// El costo usa solo input/output/cache (paridad con v1): OpenCode reporta el
// coste real en session_v2.cost cuando es no-cero; aquí solo estimamos.
const V2_STEP_COLUMNS = `COALESCE(json_extract(m.data, '$.tokens.input'), 0) as input_tokens,
              COALESCE(json_extract(m.data, '$.tokens.output'), 0) as output_tokens,
              COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0) as cache_read,
              COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) as cache_write,
              COALESCE(json_extract(m.data, '$.tokens.input'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.output'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)
                + COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) as total_tokens,
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
function stepFinishRowToBlockCost(row: StepFinishRow, modelId: string): BlockCostEntry | null {
  const price = calcCost(modelId, {
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cache_read_input_tokens: row.cache_read ?? 0,
    cache_creation_input_tokens: row.cache_write ?? 0,
  })
  if (price <= 0) return null
  return {
    inputUsd:       price * 0.7,
    outputUsd:      price * 0.3,
    totalUsd:       price,
    inputTokens:    (row.input_tokens ?? 0) + (row.cache_read ?? 0) + (row.cache_write ?? 0),
    outputTokens:   row.output_tokens ?? 0,
    cacheRead:      row.cache_read ?? 0,
    cacheCreate:    row.cache_write ?? 0,
    context_used:   row.total_tokens,
    context_window: getContextWindow(modelId),
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

function groupOcSessions(
  rows: Array<{
    id: string; directory: string | null; model: string | null
    cost: number; tokens_input: number; tokens_output: number
    tokens_cache_read: number; tokens_cache_write: number
    time_created: number; time_updated: number
  }>
): typeof rows {
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
      const rows = db.prepare(
        `SELECT id, directory, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                time_created, time_updated
         FROM ${ocSessionTable(db)}
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
        const modelId = parseModel(row.model)
        const dir = row.directory
        const shouldInfer = !dir || dir === HOME || dir.split(/[/\\]/).filter(Boolean).length <= 3
        const inferred = shouldInfer ? inferProjectFromParts(db, row.id) : undefined
        const projectCwd = inferred ?? dir ?? undefined

        const realCost = row.cost
        const estimatedCost = realCost !== 0 ? realCost : calcCost(modelId, {
          input_tokens: row.tokens_input,
          output_tokens: row.tokens_output,
          cache_read_input_tokens: row.tokens_cache_read,
          cache_creation_input_tokens: row.tokens_cache_write,
        })

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
                lastEntry = stepFinishRowToBlockCost(stepFinish, modelId) ?? undefined
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
            cost_usd: estimatedCost,
            context_used: contextUsed,
            context_window: getContextWindow(modelId),
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
    const modelId = parseModel(sessionRow?.model ?? null)

    const rows = querySteps(db, sessionId, v2, 'ASC')

    const blocks = rows
      .filter(r => r.total_tokens)
      .map(r => stepFinishRowToBlockCost(r, modelId))
      .filter((b): b is BlockCostEntry => b !== null)

    stepFinishBlocksCache.set(sessionId, { data: blocks, ts: Date.now() })
    return blocks
  } catch {
    return cached?.data ?? []
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
