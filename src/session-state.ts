/**
 * session-state.ts — State machine para estado de sesión en tiempo real
 *
 * Estados posibles:
 *   working           — Claude está ejecutando un tool (PreToolUse recibido)
 *   waiting_for_input — Claude terminó su turno (Stop recibido) o sesión recién iniciada
 *   idle              — Sin actividad por > IDLE_THRESHOLD_MS
 *
 * Diseño: módulo puro sin efectos secundarios ni acceso a DB.
 * El estado se DERIVA a demanda desde el último evento y su timestamp.
 * No se persiste en DB — se recalcula en cada broadcast y endpoint.
 *
 * Por qué no persistir:
 * - El estado decae automáticamente a "idle" por tiempo, sin necesidad de evento
 * - Simplifica migraciones y evita estados "atascados" en DB
 */

export type SessionState = 'working' | 'waiting_for_input' | 'idle'

// 5 minutos sin actividad → idle automático
const IDLE_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Deriva el estado de sesión a partir del último evento y su timestamp.
 *
 * Reglas (en orden de prioridad):
 * 1. Si han pasado > IDLE_THRESHOLD_MS desde el último evento → idle
 * 2. PreToolUse o PostToolUse → working (Claude está ejecutando o procesando resultado)
 * 3. Stop o SessionStart → waiting_for_input
 * 4. Cualquier otro tipo → waiting_for_input (estado conservador)
 */
export function deriveSessionState(
  lastEventType: string | undefined,
  lastEventTs:   number,
  now:           number = Date.now()
): SessionState {
  if (now - lastEventTs > IDLE_THRESHOLD_MS) return 'idle'

  switch (lastEventType) {
    case 'PreToolUse':   return 'working'
    case 'PostToolUse':  return 'working'          // tool terminó, Claude aún procesa la respuesta
    case 'Stop':         return 'waiting_for_input'
    case 'SessionStart': return 'waiting_for_input'
    default:             return 'waiting_for_input'
  }
}

/**
 * Metadatos visuales para cada estado — usados en dashboard y CLI.
 */
export const STATE_META: Record<SessionState, { label: string; color: string; pulse: boolean }> = {
  working:           { label: 'working', color: '#3fb950', pulse: true  },
  waiting_for_input: { label: 'waiting', color: '#58a6ff', pulse: false },
  idle:              { label: 'idle',    color: '#7d8590', pulse: false },
}
