/**
 * store.ts — Store en memoria para eventos de sesión
 *
 * Decisión de Phase 1: usamos un Map en memoria en lugar de SQLite.
 *
 * Por qué:
 * - Phase 1 es visualización en tiempo real, no análisis histórico
 * - Elimina todas las dependencias nativas (sin compilación)
 * - SQLite se añade en Phase 2 cuando necesitemos persistencia
 *   para loops, presupuesto y eficiencia
 *
 * Limitación conocida: si el daemon se reinicia, el historial se pierde.
 * Esto es aceptable en Phase 1.
 */

export interface SessionRow {
  id: string
  cwd?: string
  started_at: number
  last_event_at?: number
}

export interface EventRow {
  id?: number
  session_id: string
  type: string
  tool_name?: string
  tool_input?: string
  tool_response?: string
  ts: number
  cwd?: string
  duration_ms?: number
}

// Sesiones indexadas por session_id
const sessions = new Map<string, SessionRow>()
// Eventos indexados por session_id → array ordenado por ts
const events   = new Map<string, EventRow[]>()

let eventIdCounter = 0

export const dbOps = {
  upsertSession(s: SessionRow) {
    const existing = sessions.get(s.id)
    sessions.set(s.id, {
      ...s,
      started_at:    existing?.started_at ?? s.started_at,
      last_event_at: s.last_event_at
    })
  },

  insertEvent(e: EventRow): number {
    const id = ++eventIdCounter
    const row: EventRow = { ...e, id }
    if (!events.has(e.session_id)) events.set(e.session_id, [])
    events.get(e.session_id)!.push(row)
    return id
  },

  /**
   * Parear PostToolUse con el PreToolUse pendiente más reciente del mismo tool.
   * Marca el PreToolUse como 'Done' y guarda la duración.
   */
  pairPostWithPre(sessionId: string, toolName: string, response: string, postTs: number): number | null {
    const sessionEvents = events.get(sessionId) || []
    // Buscar de atrás hacia adelante: el último PreToolUse sin response para este tool
    for (let i = sessionEvents.length - 1; i >= 0; i--) {
      const ev = sessionEvents[i]
      if (ev.type === 'PreToolUse' && ev.tool_name === toolName && !ev.tool_response) {
        ev.type         = 'Done'
        ev.tool_response = response
        ev.duration_ms  = postTs - ev.ts
        return ev.id ?? null
      }
    }
    return null
  },

  getSessionEvents(sessionId: string): EventRow[] {
    return events.get(sessionId) || []
  },

  getLatestSession(): SessionRow | undefined {
    let latest: SessionRow | undefined
    for (const s of sessions.values()) {
      if (!latest || (s.last_event_at ?? 0) > (latest.last_event_at ?? 0)) {
        latest = s
      }
    }
    return latest
  },

  getAllSessions(): SessionRow[] {
    return [...sessions.values()].sort((a, b) => b.started_at - a.started_at)
  }
}
