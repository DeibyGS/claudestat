import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'
import { getOpencodeEvents } from './opencode-reader'

export const replayRouter = Router()

const CONTEXT_WINDOW = 200_000

interface AssistantTurn {
  turn_index:   number
  ts?:          number
  text_preview?: string
  tool_calls:   string[]
  error_count:  number
  output_chars: number
  context_used: number
}

function convertOpencodeToTurns(
  events: { type: string; tool_name?: string; ts?: number }[],
  prompts: { index: number; ts: number; text: string }[]
): AssistantTurn[] {
  const turns: AssistantTurn[] = []
  let currentTools: string[] = []
  let turnTs = 0
  let promptIdx = 0

  for (const event of events) {
    if (event.type === 'Stop') {
      if (currentTools.length > 0) {
        const prompt = promptIdx < prompts.length ? prompts[promptIdx] : undefined
        turns.push({
          turn_index: turns.length,
          ts: turnTs,
          text_preview: prompt?.text ?? undefined,
          tool_calls: [...new Set(currentTools)],
          error_count: 0,
          output_chars: 0,
          context_used: 0,
        })
        promptIdx++
        currentTools = []
      }
    } else if (event.type === 'Done' || event.type === 'PreToolUse') {
      if (event.tool_name && !currentTools.includes(event.tool_name)) {
        currentTools.push(event.tool_name)
      }
      if (event.ts && event.ts > turnTs) {
        turnTs = event.ts
      }
    }
  }

  if (currentTools.length > 0) {
    const prompt = promptIdx < prompts.length ? prompts[promptIdx] : undefined
    turns.push({
      turn_index: turns.length,
      ts: turnTs,
      text_preview: prompt?.text ?? undefined,
      tool_calls: [...new Set(currentTools)],
      error_count: 0,
      output_chars: 0,
      context_used: 0,
    })
  }

  return turns
}

replayRouter.get('/session/:id/replay', (req: Request, res: Response) => {
  const { id } = req.params

  const session = dbOps.getSession(id)
  if (session?.source === 'opencode') {
    try {
      const { events, prompts } = getOpencodeEvents(id)
      const turns = convertOpencodeToTurns(events, prompts)
      res.json({ turns, context_window: CONTEXT_WINDOW })
    } catch {
      res.json({ turns: [], context_window: CONTEXT_WINDOW })
    }
    return
  }

  const turns = dbOps.getAssistantTurns(id)
  res.json({ turns, context_window: CONTEXT_WINDOW })
})

interface AgentNode {
  id: string
  dominant_model?: string
  total_cost_usd?: number
  started_at: number
  children: AgentNode[]
}

function buildTree(sessionId: string, depth = 0): AgentNode {
  if (depth > 5) return { id: sessionId, started_at: 0, children: [] }
  const session  = dbOps.getSession(sessionId)
  const children = dbOps.getChildSessions(sessionId)
  return {
    id:              sessionId,
    dominant_model:  session?.dominant_model ?? undefined,
    total_cost_usd:  session?.total_cost_usd ?? undefined,
    started_at:      session?.started_at ?? 0,
    children:        children.map(c => buildTree(c.id, depth + 1)),
  }
}

replayRouter.get('/session/:id/agent-tree', (req: Request, res: Response) => {
  const { id } = req.params
  res.json(buildTree(id))
})
