// ─── GET /stream — SSE para claudestat watch ─────────────────────────────────

import { Router, type Request, type Response } from 'express'
import { dbOps, type EventRow } from '../db'
import type { BlockCostEntry, SessionRow } from '../db'
import { processLatestForSession, getAllBlockCostsForSession } from '../enricher'
import { findJSONLForSession, extractSemanticData, syntheticStopsFor } from '../watchers/claude-code'
import { getAllStepFinishBlocksForSession } from '../watchers/opencode'
import { deriveSessionState } from '../session-state'

export const streamRouter = Router()

const SSE_INIT_EVENT_LIMIT = 2000

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

const latestSession = dbOps.getLatestSession()
  if (latestSession) {
    const allEvents   = dbOps.getSessionEvents(latestSession.id)
    const lastEvt     = sessionLastEvent.get(latestSession.id)
    const state       = deriveSessionState(lastEvt?.type, lastEvt?.ts ?? latestSession.last_event_at ?? latestSession.started_at)

    // Stops sintéticos por turno CC: ver syntheticStopsFor(). Si el JSONL no existe
    // se envían solo los eventos reales. Se mergean para que la primera conexión
    // muestre los bloques por turno igual que OC (consistente con /api/session-events).
    const withSynStops = (base: EventRow[]): Promise<EventRow[]> => {
      if (latestSession.source !== 'claude-code') return Promise.resolve(base)
      return findJSONLForSession(latestSession.id).then(async filePath => {
        try {
          if (!filePath) return base
          const semantic = await extractSemanticData(filePath)
          if (!semantic) return base
          const realStopTs = base.filter(e => e.type === 'Stop').map(s => Number(s.ts))
          const synStops   = syntheticStopsFor(latestSession.id, semantic.turns, realStopTs)
          return [...base, ...synStops] as EventRow[]
        } catch { return base }
      }).catch(() => base)
    }

    // El historial de bloques (blockCosts) se lee por fuente — CC del .jsonl, OC de su
    // SQLite — así que se busca contra la sesión más reciente DE CADA FUENTE, no contra
    // "latestSession" (que es de una sola) — para no perder el historial de la otra
    // cuando corren en simultáneo. Cada entry queda tagged con el id real de su sesión.
    const ccSessionForBlocks = latestSession.source === 'claude-code'
      ? latestSession
      : dbOps.getLatestClaudeSession()
    const ocSessionForBlocks = latestSession.source === 'opencode'
      ? latestSession
      : dbOps.getLatestOpencodeSession()

    withSynStops(allEvents).then(merged => {
      const initEvents = merged.length > SSE_INIT_EVENT_LIMIT
        ? merged.slice(-SSE_INIT_EVENT_LIMIT)
        : merged

      const tagBlocks = (session: SessionRow | undefined, fetchBlocks: (id: string) => Promise<BlockCostEntry[]>) =>
        session
          ? fetchBlocks(session.id).then(costs => costs.map(c => ({ ...c, sessionId: session.id })))
          : Promise.resolve([])

      const blockCostsPromise = Promise.all([
        tagBlocks(ccSessionForBlocks, getAllBlockCostsForSession),
        tagBlocks(ocSessionForBlocks, getAllStepFinishBlocksForSession),
      ]).then(([ccBlocks, ocBlocks]) => [...ccBlocks, ...ocBlocks])

      blockCostsPromise.then((blockCosts) => {
        const subAgentSessions = dbOps.getChildSessions(latestSession.id)
        res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events: initEvents, blockCosts, subAgentSessions })}\n\n`)

        if (_onCostUpdateRef) {
          processLatestForSession(latestSession.id, _onCostUpdateRef).catch((err: Error) =>
            console.error('[stream] Error processing latest session:', err)
          )
        }
      }).catch((err: Error) => {
        console.error('[stream] Error loading block costs:', err)
        const subAgentSessions = dbOps.getChildSessions(latestSession.id)
        res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events: initEvents, blockCosts: [], subAgentSessions })}\n\n`)
      })
    })
  }

  req.on('close', () => sseClients.delete(clientId))
})
