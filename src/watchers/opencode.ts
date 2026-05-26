/**
 * opencode.ts — WatcherAdapter para OpenCode (poll-based, SQLite)
 *
 * OpenCode stores sessions in ~/.local/share/opencode/opencode.db (SQLite).
 * The session table has cost, token counts, model, and timestamps directly.
 * Uses PollableAdapter — no JSONL files, no chokidar.
 */

import path from 'path'
import os from 'os'
import fs from 'fs'
import { type PollableAdapter, type PollSession, type ParsedEvent, registerAdapter } from './adapter'
import type { CostUpdate } from '../db'

const OPENCODE_DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')

function openDb() {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(OPENCODE_DB, { open: true })
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

export const opencodeAdapter: PollableAdapter = {
  name: 'opencode',
  label: 'OpenCode',
  get shortName() { return 'OC' },

  detect(): boolean {
    try {
      return fs.existsSync(OPENCODE_DB)
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
    try {
      const db = openDb()
      const stmt = db.prepare(
        `SELECT id, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, time_updated
         FROM session
         WHERE time_updated >= ?
         AND time_archived IS NULL`
      )
      const rows = stmt.all(since) as Array<{
        id: string
        model: string | null
        cost: number
        tokens_input: number
        tokens_output: number
        tokens_cache_read: number
        tokens_cache_write: number
        time_updated: number
      }>
      db.close()

      return rows.map(row => ({
        sessionId: row.id,
        cost: {
          input_tokens: row.tokens_input,
          output_tokens: row.tokens_output,
          cache_read: row.tokens_cache_read,
          cache_creation: row.tokens_cache_write,
          cost_usd: row.cost,
          context_used: 0,
          context_window: 200_000,
          lastModel: parseModel(row.model),
        } satisfies CostUpdate,
      }))
    } catch {
      return []
    }
  },
}

registerAdapter(opencodeAdapter)
