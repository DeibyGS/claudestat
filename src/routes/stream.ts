// ─── GET /stream — SSE para claudestat watch ─────────────────────────────────

import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'
import { processLatestForSession, getAllBlockCostsForSession } from '../enricher'
import { deriveSessionState } from '../session-state'

export const streamRouter = Router()

// Clientes SSE conectados — uno por cada `claudestat watch` abierto
const sseClients = new Map<string, Response>()

// Estado de sesión en memoria — se deriva a demanda, no se persiste en DB.
// Clave: session_id  Valor: {type, ts} del último evento recibido vía /event
export const sessionLastEvent = new Map<string, { type: string; ts: number }>()

export function broadcast(msg: object) {
  let data: string
  try {
    data = `data: ${JSON.stringify(msg)}\n\n`
  } catch {
    return  // objeto no serializable (ej: referencia circular) — ignorar silenciosamente
  }
  const dead: string[] = []
  sseClients.forEach((client, id) => {
    try {
      client.write(data)
    } catch {
      dead.push(id)  // socket cerrado o roto — marcar para eliminar
    }
  })
  // Limpiar clientes muertos fuera del forEach para no mutar el Map mientras se itera
  dead.forEach(id => sseClients.delete(id))
}

export function getSseClientsSize(): number {
  return sseClients.size
}

// Callback del enricher necesita onCostUpdate — se inyecta desde events.ts
// para evitar dependencia circular. El router recibe el callback al registrarse.
let _onCostUpdateRef: ((sessionId: string, cost: any) => void) | null = null
export function setOnCostUpdateRef(cb: (sessionId: string, cost: any) => void) {
  _onCostUpdateRef = cb
}

streamRouter.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  const clientId = Math.random().toString(36).slice(2)
  sseClients.set(clientId, res)

  // Estado inicial: sesión más reciente con todos sus eventos
  const latestSession = dbOps.getLatestSession()
  if (latestSession) {
    const events     = dbOps.getSessionEvents(latestSession.id)
    const lastEvt    = sessionLastEvent.get(latestSession.id)
    const state      = deriveSessionState(lastEvt?.type, lastEvt?.ts ?? latestSession.last_event_at ?? latestSession.started_at)
    const blockCosts      = getAllBlockCostsForSession(latestSession.id)
    const subAgentSessions = dbOps.getChildSessions(latestSession.id)
    res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events, blockCosts, subAgentSessions })}\n\n`)

    // Procesar el JSONL de la sesión activa para entregar contexto inmediato
    // (sin esperar al próximo mensaje de Claude)
    if (_onCostUpdateRef) {
      const cb = _onCostUpdateRef
      setImmediate(() => processLatestForSession(latestSession.id, cb))
    }
  }

  req.on('close', () => sseClients.delete(clientId))
})
