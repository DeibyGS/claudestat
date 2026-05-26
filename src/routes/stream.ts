// ─── GET /stream — SSE para claudestat watch ─────────────────────────────────

import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'
import type { BlockCostEntry } from '../db'
import { processLatestForSession, getAllBlockCostsForSession } from '../enricher'
import { deriveSessionState } from '../session-state'

export const streamRouter = Router()

const SSE_INIT_EVENT_LIMIT = 200

const sseClients = new Map<string, Response>()

export const sessionLastEvent = new Map<string, { type: string; ts: number }>()

export function broadcast(msg: object) {
  let data: string
  try {
    data = `data: ${JSON.stringify(msg)}\n\n`
  } catch {
    return
  }
  const dead: string[] = []
  sseClients.forEach((client, id) => {
    try {
      client.write(data)
    } catch {
      dead.push(id)
    }
  })
  dead.forEach(id => sseClients.delete(id))
}

export function getSseClientsSize(): number {
  return sseClients.size
}

let _onCostUpdateRef: ((sessionId: string, cost: any, source?: string) => void) | null = null
export function setOnCostUpdateRef(cb: (sessionId: string, cost: any, source?: string) => void) {
  _onCostUpdateRef = cb
}

streamRouter.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  const clientId = Math.random().toString(36).slice(2)
  sseClients.set(clientId, res)

  const latestSession = dbOps.getLatestClaudeSession()
  if (latestSession) {
    const allEvents   = dbOps.getSessionEvents(latestSession.id)
    const events      = allEvents.length > SSE_INIT_EVENT_LIMIT
      ? allEvents.slice(-SSE_INIT_EVENT_LIMIT)
      : allEvents
    const lastEvt     = sessionLastEvent.get(latestSession.id)
    const state       = deriveSessionState(lastEvt?.type, lastEvt?.ts ?? latestSession.last_event_at ?? latestSession.started_at)

    getAllBlockCostsForSession(latestSession.id).then((blockCosts: BlockCostEntry[]) => {
      const subAgentSessions = dbOps.getChildSessions(latestSession.id)
      res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events, blockCosts, subAgentSessions })}\n\n`)

      if (_onCostUpdateRef) {
        processLatestForSession(latestSession.id, _onCostUpdateRef).catch((err: Error) =>
          console.error('[stream] Error processing latest session:', err)
        )
      }
    }).catch((err: Error) => {
      console.error('[stream] Error loading block costs:', err)
      const subAgentSessions = dbOps.getChildSessions(latestSession.id)
      res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events, blockCosts: [], subAgentSessions })}\n\n`)
    })
  }

  req.on('close', () => sseClients.delete(clientId))
})
