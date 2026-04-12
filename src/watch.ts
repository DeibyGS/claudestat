/**
 * watch.ts — Cliente SSE + renderizador (Phase 2)
 *
 * Novedades:
 * - Maneja el evento 'cost_update' que llega del enricher
 * - Actualiza cost en estado y redibuja con datos reales
 */

import http from 'http'
import { renderTrace, type RenderState, type TraceEvent, type CostInfo } from './render'

const DAEMON_HOST = 'localhost'
const DAEMON_PORT = 7337

function clearScreen() { process.stdout.write('\x1b[2J\x1b[H') }

async function checkDaemon(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://${DAEMON_HOST}:${DAEMON_PORT}/health`, res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

function connectSSE(onMessage: (msg: any) => void): Promise<void> {
  return new Promise((_, reject) => {
    const req = http.request({
      hostname: DAEMON_HOST, port: DAEMON_PORT, path: '/stream', method: 'GET',
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }
    }, res => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              try { onMessage(JSON.parse(line.slice(6))) } catch {}
            }
          }
        }
      })
      res.on('end', () => reject(new Error('Stream cerrado')))
    })
    req.on('error', reject)
    req.end()
  })
}

export async function startWatch() {
  const alive = await checkDaemon()
  if (!alive) {
    console.error('\n❌ El daemon no está corriendo.')
    console.error('   Ejecutá: \x1b[36mclaudetrace start\x1b[0m\n')
    process.exit(1)
  }

  let state: RenderState = {
    sessionId: '', cwd: '', startedAt: Date.now(), events: []
  }

  function draw() {
    if (state.sessionId) { clearScreen(); process.stdout.write(renderTrace(state)) }
  }

  function handleMessage(msg: any) {
    if (msg.type === 'init') {
      if (msg.session) {
        state = {
          sessionId:  msg.session.id,
          cwd:        msg.session.cwd || '',
          startedAt:  msg.session.started_at,
          events:     (msg.events || []) as TraceEvent[],
          cost:       buildCostFromSession(msg.session)
        }
      }

    } else if (msg.type === 'event') {
      const evt = msg.payload as TraceEvent & { session_id: string }

      // Nueva sesión → resetear estado
      if (evt.session_id && evt.session_id !== state.sessionId && state.sessionId !== '') {
        state = { sessionId: evt.session_id, cwd: evt.cwd || '', startedAt: evt.ts, events: [] }
      } else if (!state.sessionId && evt.session_id) {
        state.sessionId = evt.session_id
        state.cwd       = evt.cwd || ''
        state.startedAt = evt.ts
      }

      if (evt.type === 'Done' && evt.tool_name) {
        // Actualizar el PreToolUse pendiente a Done
        const pending = [...state.events].reverse()
          .find(e => e.type === 'PreToolUse' && e.tool_name === evt.tool_name)
        if (pending) { pending.type = 'Done'; pending.duration_ms = evt.ts - pending.ts }
      } else {
        state.events.push(evt)
      }

    } else if (msg.type === 'cost_update') {
      // El enricher calculó el coste real desde el JSONL — actualizar estado
      const p = msg.payload
      if (p.session_id === state.sessionId) {
        state.cost = {
          cost_usd:         p.cost_usd,
          input_tokens:     p.input_tokens,
          output_tokens:    p.output_tokens,
          cache_read:       p.cache_read,
          cache_creation:   p.cache_creation,
          efficiency_score: p.efficiency_score,
          loops:            p.loops || [],
          summary:          p.summary
        }
      }
    }

    draw()
  }

  clearScreen()
  process.stdout.write('\x1b[36m● claudetrace watch\x1b[0m — conectando...\n')

  while (true) {
    try { await connectSSE(handleMessage) }
    catch {
      clearScreen()
      console.log('\x1b[33m⚠ Conexión perdida. Reconectando en 2s...\x1b[0m')
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

function buildCostFromSession(session: any): CostInfo | undefined {
  if (!session?.total_cost_usd) return undefined
  return {
    cost_usd:         session.total_cost_usd      ?? 0,
    input_tokens:     session.total_input_tokens  ?? 0,
    output_tokens:    session.total_output_tokens ?? 0,
    cache_read:       session.total_cache_read    ?? 0,
    cache_creation:   session.total_cache_creation ?? 0,
    efficiency_score: session.efficiency_score    ?? 100,
    loops:            []
  }
}
