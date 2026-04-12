/**
 * daemon.ts — Servidor HTTP + SSE
 *
 * El daemon cumple dos roles:
 *   1. Recibir eventos de los hooks de Claude Code (POST /event)
 *   2. Transmitirlos en tiempo real a los clientes watch (GET /stream via SSE)
 *
 * SSE (Server-Sent Events) es más simple que WebSockets para este caso:
 * es unidireccional (server → client), y el navegador/Node.js lo soporta nativamente.
 */

import express, { type Request, type Response } from 'express'
import { dbOps } from './db'

const PORT = 7337
const app  = express()
app.use(express.json())

// Clientes SSE activos — cada claudetrace watch abre una conexión aquí
const sseClients = new Map<string, Response>()

function broadcast(msg: object) {
  const data = `data: ${JSON.stringify(msg)}\n\n`
  sseClients.forEach(client => client.write(data))
}

// ── POST /event ───────────────────────────────────────────────────────────────
// Los hooks de Claude Code hacen POST aquí con cada evento del ciclo de vida
app.post('/event', (req: Request, res: Response) => {
  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Faltan session_id o type' })
    return
  }

  // Inferir cwd desde transcript_path si no viene explícito
  const resolvedCwd = cwd || (transcript_path
    ? transcript_path.split('/').slice(0, -1).join('/')
    : undefined)

  dbOps.upsertSession({
    id: session_id,
    cwd: resolvedCwd,
    started_at: ts,
    last_event_at: ts
  })

  if (type === 'PostToolUse' && tool_name) {
    // Parear con el PreToolUse pendiente en lugar de insertar nuevo registro
    const pairedId = dbOps.pairPostWithPre(
      session_id,
      tool_name,
      typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? ''),
      ts
    )
    // Broadcast para que el watch actualice el evento pendiente a "Done"
    broadcast({
      type: 'event',
      payload: { type: 'Done', session_id, tool_name, tool_input, ts, cwd: resolvedCwd, pairedId }
    })
  } else {
    dbOps.insertEvent({ session_id, type, tool_name, tool_input: tool_input ? JSON.stringify(tool_input) : undefined, ts, cwd: resolvedCwd })
    broadcast({ type: 'event', payload: req.body })
  }

  res.json({ ok: true })
})

// ── GET /stream ───────────────────────────────────────────────────────────────
// Endpoint SSE — el cliente watch se conecta aquí y recibe eventos en tiempo real
app.get('/stream', (req: Request, res: Response) => {
  // Headers obligatorios para SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const clientId = Math.random().toString(36).slice(2)
  sseClients.set(clientId, res)

  // Enviar el estado inicial de la sesión más reciente para que
  // el watch no arranque en blanco si ya hay eventos previos
  const latestSession = dbOps.getLatestSession()
  if (latestSession) {
    const events = dbOps.getSessionEvents(latestSession.id)
    res.write(`data: ${JSON.stringify({ type: 'init', session: latestSession, events })}\n\n`)
  }

  req.on('close', () => sseClients.delete(clientId))
})

// ── GET /health ───────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: sseClients.size })
})

// ── GET /sessions — para debug y futuros clientes ─────────────────────────────
app.get('/sessions', (_req: Request, res: Response) => {
  const all = dbOps.getAllSessions()
  const withEvents = all.map(s => ({
    ...s,
    events: dbOps.getSessionEvents(s.id)
  }))
  res.json(withEvents)
})

export function startDaemon() {
  app.listen(PORT, () => {
    console.log(`\n● claudetrace daemon  →  http://localhost:${PORT}`)
    console.log(`  Esperando eventos de Claude Code...\n`)
    console.log(`  En otra terminal ejecutá: ${'\x1b[36m'}claudetrace watch${'\x1b[0m'}\n`)
  })
}
