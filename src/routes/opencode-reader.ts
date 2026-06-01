/**
 * opencode-reader.ts — Lee sesiones de OpenCode desde su SQLite y las mapea
 * al formato TraceEvent[] que entiende el dashboard.
 *
 * GET /api/opencode/session/:id → { events: TraceEvent[], totalParts: number }
 */

import fs   from 'fs'
import { Router, type Request, type Response } from 'express'
import { getOpencodeDb } from '../paths'

export const opencodeReaderRouter = Router()

export interface TraceEvent {
  type: string
  tool_name?: string
  tool_input?: string
  ts: number
  duration_ms?: number
  cwd?: string
}

export interface PromptItem {
  index: number
  ts:    number
  text:  string
}

export function getOpencodeEvents(sessionId: string): { events: TraceEvent[]; totalParts: number; prompts: PromptItem[] } {
  if (!fs.existsSync(getOpencodeDb())) {
    throw new Error('OpenCode DB not found')
  }

  const db = openDb()

  try {
    // ── Find all related session IDs (OpenCode creates one session per prompt) ──
    const sessionRow = db.prepare(`
      SELECT directory, time_created FROM session WHERE id = ?
    `).get(sessionId) as { directory: string | null; time_created: number } | undefined

    let sessionIds = [sessionId]
    if (sessionRow?.directory) {
      const sameDir = db.prepare(`
        SELECT id, time_created FROM session
        WHERE directory = ? AND time_archived IS NULL
        ORDER BY time_created ASC
      `).all(sessionRow.directory) as Array<{ id: string; time_created: number }>

      if (sameDir.length > 1) {
        let idx = sameDir.findIndex(s => s.id === sessionId)
        if (idx !== -1) {
          let end = idx
          for (let i = idx + 1; i < sameDir.length; i++) {
            if (sameDir[i].time_created - sameDir[i - 1].time_created > 300_000) break
            end = i
          }
          let begin = idx
          for (let i = idx - 1; i >= 0; i--) {
            if (sameDir[begin].time_created - sameDir[i].time_created > 300_000) break
            begin = i
          }
          sessionIds = sameDir.slice(begin, end + 1).map(s => s.id)
        }
      }
    }

    const placeholders = sessionIds.map(() => '?').join(',')
    const messages = db.prepare(`
      SELECT id, time_created, time_updated, data
      FROM message
      WHERE session_id IN (${placeholders})
      ORDER BY time_created ASC
    `).all(...sessionIds) as Array<{
      id: string
      time_created: number
      time_updated: number
      data: string
    }>

    const events: TraceEvent[] = []
    const prompts: PromptItem[] = []

    let totalParts    = 0
    let blockIndex    = 0
    let pendingPrompt: { ts: number; text: string } | null = null
    let turnHasTools  = false
    let turnEndTs     = 0
    let turnCwd: string | undefined = undefined

    function closeTurn() {
      if (!turnHasTools) return
      blockIndex++
      events.push({ type: 'Stop', ts: turnEndTs, cwd: turnCwd })
      if (pendingPrompt) {
        prompts.push({ index: blockIndex, ts: pendingPrompt.ts, text: pendingPrompt.text })
        pendingPrompt = null
      }
      turnHasTools = false
      turnEndTs    = 0
      turnCwd      = undefined
    }

    for (const msg of messages) {
      const msgData = JSON.parse(msg.data) as MessageData

      if (msgData.role === 'user') {
        closeTurn()

        const parts = db.prepare(`
          SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC
        `).all(msg.id) as Array<{ data: string }>

        const text = parts
          .map(p => { try { return JSON.parse(p.data) as PartData } catch { return null } })
          .filter((p): p is PartData => p?.type === 'text' && typeof p.text === 'string')
          .map(p => p.text!)
          .join('\n').trim()

        if (text) pendingPrompt = { ts: msg.time_created, text }
        continue
      }

      if (msgData.role !== 'assistant') continue

      const cwd = msgData.path?.cwd

      const parts = db.prepare(`
        SELECT time_created, time_updated, data
        FROM part
        WHERE message_id = ?
        ORDER BY time_created ASC
      `).all(msg.id) as Array<{
        time_created: number; time_updated: number; data: string
      }>

      for (const part of parts) {
        totalParts++
        const partData = JSON.parse(part.data) as PartData

        if (partData.type !== 'tool' || !partData.tool || !partData.state) continue

        const toolName    = mapToolName(partData.tool)
        const toolInput   = partData.state.input ? JSON.stringify(partData.state.input) : undefined
        const isCompleted = partData.state.status === 'completed'

        turnHasTools = true
        turnCwd      = cwd ?? turnCwd
        turnEndTs    = Math.max(turnEndTs, part.time_updated)

        events.push({
          type: isCompleted ? 'Done' : 'PreToolUse',
          tool_name: toolName,
          tool_input: toolInput,
          ts: part.time_created,
          ...(isCompleted && { duration_ms: part.time_updated - part.time_created }),
          cwd,
        })
      }
    }

    closeTurn()

    return { events, totalParts, prompts }
  } finally {
    db.close()
  }
}

// OpenCode tool names → claudestat canonical names
const TOOL_NAME_MAP: Record<string, string> = {
  glob: 'Glob', read: 'Read', write: 'Write', edit: 'Edit', bash: 'Bash',
  grep: 'Grep', webfetch: 'WebFetch', websearch: 'WebSearch',
  skill: 'Skill', agent: 'Agent', task: 'Task',
}

interface MessageData {
  role: string
  path?: { cwd?: string }
}

interface PartData {
  type:   string
  tool?:  string
  text?:  string
  state?: { status?: string; input?: unknown; output?: string }
}

function mapToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))
}

function openDb() {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(getOpencodeDb(), { open: true })
}

opencodeReaderRouter.get('/api/opencode/session/:id', (req: Request, res: Response) => {
  try {
    const result = getOpencodeEvents(req.params.id)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
