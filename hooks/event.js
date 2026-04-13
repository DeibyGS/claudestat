#!/usr/bin/env node
/**
 * Hook universal de claudetrace.
 * Claude Code lo ejecuta en cada evento del ciclo de vida.
 * Recibe el JSON del evento por stdin y lo reenvía al daemon.
 *
 * Uso: node event.js <TipoEvento>
 * Ejemplo: node event.js PreToolUse
 *
 * Kill switch (Phase 6):
 * Para PreToolUse, después de enviar el evento al daemon, consulta GET /kill-switch.
 * Si el daemon responde { blocked: true }, este hook termina con exit(2),
 * lo que hace que Claude Code cancele la acción del tool antes de ejecutarla.
 */

const eventType = process.argv[2] || 'Unknown'
const DAEMON_URL     = 'http://localhost:7337/event'
const KILL_SWITCH_URL = 'http://localhost:7337/kill-switch'

let rawData = ''
process.stdin.on('data', chunk => { rawData += chunk })
process.stdin.on('end', () => {
  let hookData = {}
  try { hookData = JSON.parse(rawData) } catch (_) {}

  const payload = {
    type: eventType,
    ts: Date.now(),
    ...hookData
  }

  // Para PreToolUse: enviamos el evento Y consultamos el kill-switch en paralelo.
  // Si el daemon bloquea, salimos con exit(2) para cancelar la acción.
  if (eventType === 'PreToolUse') {
    Promise.all([
      // 1. Registrar el evento (fire-and-forget, no nos importa el resultado)
      fetch(DAEMON_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1500),
      }).catch(() => null),

      // 2. Consultar el kill-switch con timeout corto para no retrasar a Claude
      fetch(KILL_SWITCH_URL, {
        signal: AbortSignal.timeout(1500),
      })
        .then(r => r.json())
        .catch(() => ({ blocked: false })),  // si el daemon no responde → no bloquear
    ])
    .then(([_, ks]) => {
      if (ks && ks.blocked) {
        // Claude Code muestra este stderr al usuario antes de cancelar la acción
        process.stderr.write(`\n🚫 claudetrace kill switch activado\n`)
        process.stderr.write(`   ${ks.reason ?? 'Cuota de uso superada.'}\n\n`)
        process.exit(2)
      } else {
        process.exit(0)
      }
    })
    .catch(() => process.exit(0))  // cualquier error → no bloquear

  } else {
    // Para todos los demás tipos (SessionStart, PostToolUse, Stop):
    // enviar el evento y siempre salir con 0 — NUNCA bloquear a Claude.
    fetch(DAEMON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    })
    .catch(() => {})  // error silencioso
    .finally(() => process.exit(0))
  }
})
