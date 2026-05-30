import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'

export const replayRouter = Router()

const CONTEXT_WINDOW = 200_000

replayRouter.get('/session/:id/replay', (req: Request, res: Response) => {
  const { id } = req.params
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
