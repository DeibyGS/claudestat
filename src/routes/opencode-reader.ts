/**
 * opencode-reader.ts — Lee sesiones de OpenCode desde su SQLite y las mapea
 * al formato TraceEvent[] que entiende el dashboard.
 *
 * GET /api/opencode/session/:id → { events: TraceEvent[], totalParts: number }
 */

import fs   from 'fs'
import { Router, type Request, type Response } from 'express'
import { getOpencodeDb } from '../paths'
import { hasOcV2, ocSessionTable } from '../watchers/oc-schema'

export const opencodeReaderRouter = Router()

export interface TraceEvent {
  type: string
  tool_name?: string
  tool_input?: string
  tool_output?: string
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
    const v2 = hasOcV2(db)

    // ── Find all related session IDs (OpenCode creates one session per prompt) ──
    const sessionRow = db.prepare(`
      SELECT directory, time_created FROM ${ocSessionTable(db)} WHERE id = ?
    `).get(sessionId) as { directory: string | null; time_created: number } | undefined

    let sessionIds = [sessionId]
    if (sessionRow?.directory) {
      const sameDir = db.prepare(`
        SELECT id, time_created FROM ${ocSessionTable(db)}
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
      SELECT id, time_created, data${v2 ? ', type' : ''}
      FROM ${v2 ? 'session_message' : 'message'}
      WHERE session_id IN (${placeholders})
      ORDER BY time_created ASC
    `).all(...sessionIds) as Array<{
      id: string
      time_created: number
      data: string
      type?: string   // solo v2 (user/assistant/...); v1 usa data.role
    }>

    // v2: los user messages traen el texto directo en data.text (sin parts)
    function readPromptText(msg: { id: string }): string {
      if (!v2) {
        const parts = db.prepare(`
          SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC
        `).all(msg.id) as Array<{ data: string }>

        return parts
          .map(p => { try { return JSON.parse(p.data) as PartData } catch { return null } })
          .filter((p): p is PartData => p?.type === 'text' && typeof p.text === 'string')
          .map(p => p.text!)
          .join('\n').trim()
      }
      const row = db.prepare(`SELECT data FROM session_message WHERE id = ?`).get(msg.id) as { data: string } | undefined
      if (!row) return ''
      try {
        const text = (JSON.parse(row.data) as { text?: unknown }).text
        return typeof text === 'string' ? text.trim() : ''
      } catch { return '' }
    }

    // v2: tool parts embebidos en data.content[]; v1: tabla part separada
    function readToolParts(msgId: string): Array<{ data: string; ts: number; tsEnd: number }> {
      if (!v2) {
        const rows = db.prepare(`
          SELECT time_created, time_updated, data
          FROM part
          WHERE message_id = ?
          ORDER BY time_created ASC
        `).all(msgId) as Array<{ time_created: number; time_updated: number; data: string }>
        return rows.map(r => ({ data: r.data, ts: r.time_created, tsEnd: r.time_updated }))
      }
      const rows = db.prepare(`
        SELECT je.value AS data, m.time_created AS msg_ts
        FROM session_message m, json_each(m.data, '$.content') je
        WHERE m.id = ?
        ORDER BY m.seq ASC
      `).all(msgId) as Array<{ data: string; msg_ts: number }>
      return rows.map(r => {
        let ts = r.msg_ts, tsEnd = r.msg_ts
        try {
          const t = (JSON.parse(r.data) as { time?: { created?: number; completed?: number } }).time
          if (t?.created) ts = t.created
          if (t?.completed) tsEnd = t.completed
        } catch {}
        return { data: r.data, ts, tsEnd }
      })
    }

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
      const role = v2 ? (msg.type ?? '') : msgData.role

      if (role === 'user') {
        closeTurn()

        const text = readPromptText(msg)
        if (text) pendingPrompt = { ts: msg.time_created, text }
        continue
      }

      if (role !== 'assistant') continue

      // v2 no guarda path.cwd en los mensajes → usar el directorio de la sesión
      const cwd = msgData.path?.cwd ?? (v2 ? (sessionRow?.directory ?? undefined) : undefined)

      const parts = readToolParts(msg.id)

      for (const part of parts) {
        totalParts++
        const partData = JSON.parse(part.data) as PartData

        const rawTool = partData.tool ?? partData.name
        if (partData.type !== 'tool' || !rawTool || !partData.state) continue

        const toolName    = mapToolName(rawTool)
        const toolInput   = partData.state.input ? JSON.stringify(partData.state.input) : undefined
        const isCompleted = partData.state.status === 'completed'
        const toolOutput  = extractToolOutput(partData.state)

        turnHasTools = true
        turnCwd      = cwd ?? turnCwd
        turnEndTs    = Math.max(turnEndTs, part.tsEnd)

        events.push({
          type: isCompleted ? 'Done' : 'PreToolUse',
          tool_name: toolName,
          tool_input: toolInput,
          ...(isCompleted && toolOutput ? { tool_output: toolOutput } : {}),
          ts: part.ts,
          ...(isCompleted && { duration_ms: Math.max(0, part.tsEnd - part.ts) }),
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
  role?: string
  path?: { cwd?: string }
}

interface PartData {
  type:   string
  tool?:  string        // v1
  name?:  string        // v2
  text?:  string
  state?: { status?: string; input?: unknown; output?: string; content?: unknown }
}

// v1 guarda el output como string en state.output; v2 lo guarda como
// array de bloques {type:'text', text} en state.content.
function extractToolOutput(state: NonNullable<PartData['state']>): string | undefined {
  if (typeof state.output === 'string' && state.output) return state.output
  if (Array.isArray(state.content)) {
    const texts = state.content
      .map(b => {
        if (!b || typeof b !== 'object') return null
        const block = b as { type?: string; text?: unknown }
        return block.type === 'text' && typeof block.text === 'string' ? block.text : null
      })
      .filter((t): t is string => t !== null)
    if (texts.length) return texts.join('\n')
  }
  return undefined
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
