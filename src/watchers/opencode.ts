/**
 * opencode.ts — WatcherAdapter para OpenCode (poll-based, SQLite)
 *
 * OpenCode stores sessions in ~/.local/share/opencode/opencode.db (SQLite).
 * The session table has cost, token counts, model, and timestamps directly.
 * Uses PollableAdapter — no JSONL files, no chokidar.
 */

import fs   from 'fs'
import os   from 'os'
import path from 'path'
import { type PollableAdapter, type PollSession, type ParsedEvent, registerAdapter } from './adapter'
import { getOpencodeDb } from '../paths'
import { getContextWindow, calcCost } from '../pricing'
import type { CostUpdate } from '../db'
import { dbOps } from '../db'
import { findProjectCwdForFile } from '../routes/helpers'

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

const HOME = os.homedir()

function inferProjectFromParts(db: ReturnType<typeof openDb> | null, sessionId: string): string | undefined {
  if (!db) return undefined
  const parts = db.prepare(`
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

function importToolEvents(ocDb: ReturnType<typeof openDb>, sessionId: string, targetSessionId?: string): void {
  const parts = ocDb.prepare(`
    SELECT p.id, p.data, p.time_created
    FROM part p
    JOIN message m ON p.message_id = m.id
    WHERE m.session_id = ?
    AND json_extract(p.data, '$.type') = 'tool'
    AND json_extract(p.data, '$.state') IS NOT NULL
    ORDER BY p.time_created ASC
  `).all(sessionId) as Array<{ id: string; data: string; time_created: number }>

  const destId = targetSessionId ?? sessionId

  const entries: Array<{ toolName: string; ts: number; externalId: string }> = []
  for (const part of parts) {
    try {
      const toolName = (JSON.parse(part.data) as { tool?: string }).tool
      if (!toolName) continue
      entries.push({ toolName, ts: part.time_created, externalId: part.id })
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
      const rows = db.prepare(
        `SELECT id, directory, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                time_created, time_updated
         FROM session
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

        return {
          sessionId: row.id,
          cwd: projectCwd,
          cost: {
            input_tokens: row.tokens_input,
            output_tokens: row.tokens_output,
            cache_read: row.tokens_cache_read,
            cache_creation: row.tokens_cache_write,
            cost_usd: estimatedCost,
            context_used: row.tokens_input + row.tokens_cache_read + row.tokens_cache_write + row.tokens_output,
            context_window: getContextWindow(modelId),
            lastModel: modelId,
            firstTs: row.time_created,
            lastTs:  row.time_updated,
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

export function isSessionArchived(sessionId: string): boolean {
  try {
    const db = openDb()
    const row = db.prepare('SELECT time_archived FROM session WHERE id = ?').get(sessionId) as { time_archived: number | null } | undefined
    db.close()
    return row === undefined || row.time_archived !== null
  } catch {
    return false
  }
}

registerAdapter(opencodeAdapter)
