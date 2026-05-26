/**
 * opencode-reader.ts — Lee sesiones de OpenCode desde su SQLite y las mapea
 * al formato TraceEvent[] que entiende el dashboard.
 *
 * GET /api/opencode/session/:id → { events: TraceEvent[], totalParts: number }
 */

import os   from 'os'
import path from 'path'
import fs   from 'fs'
import { Router, type Request, type Response } from 'express'

export const opencodeReaderRouter = Router()

const OPENCODE_DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')

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

interface TraceEvent {
  type: string
  tool_name?: string
  tool_input?: string
  ts: number
  duration_ms?: number
  cwd?: string
}

interface PromptItem {
  index: number
  ts:    number
  text:  string
}

function mapToolName(raw: string): string {
  return TOOL_NAME_MAP[raw.toLowerCase()] ?? (raw.charAt(0).toUpperCase() + raw.slice(1))
}

function openDb() {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  return new DatabaseSync(OPENCODE_DB, { open: true })
}

opencodeReaderRouter.get('/api/opencode/session/:id', (req: Request, res: Response) => {
  if (!fs.existsSync(OPENCODE_DB)) {
    res.status(404).json({ error: 'OpenCode DB not found' }); return
  }

  try {
    const { id: sessionId } = req.params
    const db = openDb()

    // Get all messages for this session ordered by time
    const messages = db.prepare(`
      SELECT id, time_created, time_updated, data
      FROM message
      WHERE session_id = ?
      ORDER BY time_created ASC
    `).all(sessionId) as Array<{
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
    // Accumulated state for the current assistant turn (may span multiple messages)
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
        // Close previous assistant turn before processing user message
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

    // Close the last assistant turn (no trailing user message)
    closeTurn()

    db.close()
    res.json({ events, totalParts, prompts })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
