#!/usr/bin/env node
/**
 * Hook universal de claudetrace.
 * Claude Code lo ejecuta en cada evento del ciclo de vida.
 * Recibe el JSON del evento por stdin y lo reenvía al daemon.
 *
 * Uso: node event.js <TipoEvento>
 * Ejemplo: node event.js PreToolUse
 */

const eventType = process.argv[2] || 'Unknown'
const DAEMON_URL = 'http://localhost:7337/event'

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

  // Enviamos al daemon. Si no está corriendo, falla silenciosamente
  // para NUNCA bloquear a Claude Code.
  fetch(DAEMON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000)  // máximo 2s de espera
  })
  .catch(() => {})  // error silencioso
  .finally(() => process.exit(0))
})
