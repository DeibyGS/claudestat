/**
 * daemon.ts — Servidor HTTP + SSE con inteligencia integrada
 *
 * Phase 2 agrega:
 * - Enriquecimiento de coste desde JSONL (enricher)
 * - Análisis de inteligencia (loops + eficiencia) al recibir cada cost update
 * - Endpoint GET /intelligence/:sessionId
 * - Endpoint GET /sessions para el dashboard futuro
 */

import express, { type Request, type Response } from 'express'
import { dbOps }                                 from './db'
import { startEnricher, type CostUpdateCallback } from './enricher'
import { analyzeSession }                         from './intelligence'

const PORT = 7337
const app  = express()
app.use(express.json())

// Clientes SSE conectados — uno por cada `claudetrace watch` abierto
const sseClients = new Map<string, Response>()

function broadcast(msg: object) {
  const data = `data: ${JSON.stringify(msg)}\n\n`
  sseClients.forEach(client => client.write(data))
}

// ─── POST /event — recibe eventos de los hooks de Claude Code ─────────────────

app.post('/event', (req: Request, res: Response) => {
  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Faltan session_id o type' })
    return
  }

  const resolvedCwd = cwd
    ?? (transcript_path ? transcript_path.split('/').slice(0, -1).join('/') : undefined)

  dbOps.upsertSession({ id: session_id, cwd: resolvedCwd, started_at: ts, last_event_at: ts })

  if (type === 'PostToolUse' && tool_name) {
    const pairedId = dbOps.pairPostWithPre(
      session_id, tool_name,
      typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? ''),
      ts
    )
    broadcast({ type: 'event', payload: { type: 'Done', session_id, tool_name, tool_input, ts, pairedId } })
  } else {
    dbOps.insertEvent({
      session_id, type,
      tool_name: tool_name ?? undefined,
      tool_input: tool_input ? JSON.stringify(tool_input) : undefined,
      ts, cwd: resolvedCwd
    })
    broadcast({ type: 'event', payload: req.body })
  }

  res.json({ ok: true })
})

// ─── GET /stream — SSE para claudetrace watch ─────────────────────────────────

app.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  const clientId = Math.random().toString(36).slice(2)
  sseClients.set(clientId, res)

  // Estado inicial: sesión más reciente con todos sus eventos
  const latestSession = dbOps.getLatestSession()
  if (latestSession) {
    const events = dbOps.getSessionEvents(latestSession.id)
    res.write(`data: ${JSON.stringify({ type: 'init', session: latestSession, events })}\n\n`)
  }

  req.on('close', () => sseClients.delete(clientId))
})

// ─── GET /intelligence/:sessionId — reporte de inteligencia ──────────────────

app.get('/intelligence/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params
  const session = dbOps.getSession(sessionId)
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  const events = dbOps.getSessionEvents(sessionId)
  const report = analyzeSession(events, session.total_cost_usd ?? 0)
  res.json({ sessionId, ...report })
})

// ─── GET /sessions — listado para dashboard futuro ────────────────────────────

app.get('/sessions', (_req: Request, res: Response) => {
  res.json(dbOps.getAllSessions())
})

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: sseClients.size })
})

// ─── Callback del enricher ────────────────────────────────────────────────────

/**
 * Cuando el enricher detecta nuevos tokens en un JSONL:
 * 1. Corre el análisis de inteligencia
 * 2. Guarda el coste + score en DB
 * 3. Hace broadcast vía SSE para que el watch muestre el coste actualizado
 */
const onCostUpdate: CostUpdateCallback = (sessionId, cost) => {
  const events  = dbOps.getSessionEvents(sessionId)
  const report  = analyzeSession(events, cost.cost_usd)

  dbOps.updateSessionCost(sessionId, cost, report.efficiencyScore, report.loops.length)

  broadcast({
    type: 'cost_update',
    payload: {
      session_id:       sessionId,
      cost_usd:         cost.cost_usd,
      input_tokens:     cost.input_tokens,
      output_tokens:    cost.output_tokens,
      cache_read:       cost.cache_read,
      cache_creation:   cost.cache_creation,
      efficiency_score: report.efficiencyScore,
      loops:            report.loops,
      summary:          report.summary
    }
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startDaemon() {
  app.listen(PORT, () => {
    console.log(`\n● claudetrace daemon  →  http://localhost:${PORT}`)
    console.log(`  Esperando eventos de Claude Code...\n`)
    console.log(`  En otra terminal: \x1b[36mclaudetrace watch\x1b[0m\n`)

    // Iniciar el watcher de JSONL para enriquecimiento de coste
    startEnricher(onCostUpdate)
  })
}
