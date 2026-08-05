/**
 * session-tracker.ts — Detección de cierre de sesión por reemplazo
 *
 * Claude Code dispara el hook `Stop` tras CADA turno, no cuando la sesión
 * se cierra. Por eso no podemos notificar "session closed" en cada Stop:
 * una sesión larga produciría N notificaciones idénticas.
 *
 * Señal determinista disponible: cuando llega un evento de una sesión NUEVA
 * del mismo source (id distinto, excluyendo sub-agentes `agent-*`), la sesión
 * anterior quedó cerrada por definición — ese evento nuevo solo puede llegar
 * si la anterior terminó.
 *
 * Módulo puro, sin DB. El daemon inyecta `onSessionClosed` para notificar.
 */

export interface SessionTrackerOptions {
  /** Decide si un session_id pertenece a un sub-agente (no cuenta como sesión). */
  isSubagent?: (sessionId: string) => boolean
  /** Se invoca exactamente 1 vez por sesión cerrada (por reemplazo o flush). */
  onSessionClosed: (sessionId: string) => void
}

export interface SessionTracker {
  /** Llama por CADA evento entrante real (antes o después de insertar en DB). */
  observe(source: string, sessionId: string): void
  /** Notifica la(s) sesión(es) activa(s) aún no notificada(s). Usado en shutdown. */
  flushPending(source?: string): void
  /** Test/documentación: sesión activa de un source (sin exponer internals). */
  activeOf?(source: string): string | undefined
}

export function createSessionTracker(opts: SessionTrackerOptions): SessionTracker {
  const isSubagent = opts.isSubagent ?? ((id: string) => id.startsWith('agent-'))

  const activeSessionBySource = new Map<string, string>()
  const notifiedSessions = new Set<string>()

  function closeSession(sessionId: string): void {
    if (notifiedSessions.has(sessionId)) return
    notifiedSessions.add(sessionId)
    opts.onSessionClosed(sessionId)
  }

  return {
    observe(source, sessionId) {
      if (isSubagent(sessionId)) return

      const prev = activeSessionBySource.get(source)
      if (!prev) {
        activeSessionBySource.set(source, sessionId)
        return
      }
      if (prev === sessionId) return

      // Sesión nueva → la anterior cerró.
      closeSession(prev)
      activeSessionBySource.set(source, sessionId)
    },

    flushPending(source) {
      const sources = source
        ? [source]
        : [...activeSessionBySource.keys()]

      for (const src of sources) {
        const active = activeSessionBySource.get(src)
        if (active) closeSession(active)
      }
    },

    activeOf(source) {
      return activeSessionBySource.get(source)
    },
  }
}