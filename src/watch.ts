/**
 * watch.ts — Cliente SSE + renderizador de terminal
 *
 * Se conecta al daemon via SSE y redibuja el trace tree en tiempo real.
 * Usamos el módulo `http` nativo de Node para el SSE en lugar de fetch()
 * porque el stream de fetch puede tener comportamiento inconsistente
 * en diferentes versiones de Node para SSE de larga duración.
 */

import http from 'http'
import { renderTrace, type RenderState, type TraceEvent } from './render'

const DAEMON_HOST = 'localhost'
const DAEMON_PORT = 7337

// Limpiar la pantalla y volver al inicio (ANSI escape)
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H')
}

async function checkDaemon(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://${DAEMON_HOST}:${DAEMON_PORT}/health`, res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

// Conectar al SSE y procesar eventos línea a línea
function connectSSE(onMessage: (msg: any) => void): Promise<void> {
  return new Promise((_, reject) => {
    const req = http.request({
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: '/stream',
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }
    }, (res) => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        // SSE delimita mensajes con doble newline (\n\n)
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
      res.on('end', () => reject(new Error('Stream cerrado por el servidor')))
    })
    req.on('error', reject)
    req.end()
  })
}

export async function startWatch() {
  console.log('Verificando daemon...')

  const alive = await checkDaemon()
  if (!alive) {
    console.error('\n❌ El daemon no está corriendo.')
    console.error('   Ejecutá primero en otra terminal: \x1b[36mclaudetrace start\x1b[0m\n')
    process.exit(1)
  }

  // Estado del trace que se actualiza con cada evento SSE
  let state: RenderState = {
    sessionId: '',
    cwd: '',
    startedAt: Date.now(),
    events: []
  }

  function handleMessage(msg: any) {
    if (msg.type === 'init') {
      // Estado inicial al conectar: cargar sesión más reciente desde DB
      if (msg.session) {
        state = {
          sessionId: msg.session.id,
          cwd: msg.session.cwd || '',
          startedAt: msg.session.started_at,
          events: (msg.events || []) as TraceEvent[]
        }
      }
    } else if (msg.type === 'event') {
      const evt = msg.payload as TraceEvent & { session_id: string }

      // Nueva sesión detectada → resetear estado
      if (evt.session_id && evt.session_id !== state.sessionId && state.sessionId !== '') {
        state = {
          sessionId: evt.session_id,
          cwd: evt.cwd || '',
          startedAt: evt.ts,
          events: []
        }
      } else if (!state.sessionId && evt.session_id) {
        state.sessionId = evt.session_id
        state.cwd = evt.cwd || ''
        state.startedAt = evt.ts
      }

      if (evt.type === 'Done' && evt.tool_name) {
        // El PostToolUse llegó: actualizar el PreToolUse pendiente con duration
        const pending = [...state.events]
          .reverse()
          .find(e => e.type === 'PreToolUse' && e.tool_name === evt.tool_name)
        if (pending) {
          pending.type = 'Done'
          pending.duration_ms = evt.ts - pending.ts
        }
      } else {
        state.events.push(evt)
      }
    }

    // Redibujar solo si hay sesión activa
    if (state.sessionId) {
      clearScreen()
      process.stdout.write(renderTrace(state))
    }
  }

  clearScreen()
  process.stdout.write('\x1b[36m● claudetrace watch\x1b[0m — conectando al daemon...\n')

  // Intentar reconectar automáticamente si se pierde la conexión
  while (true) {
    try {
      await connectSSE(handleMessage)
    } catch (err: any) {
      clearScreen()
      console.log('\x1b[33m⚠ Conexión perdida. Reconectando en 2s...\x1b[0m')
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}
