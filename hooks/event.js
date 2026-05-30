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
const fs = require('fs')
const os = require('os')

// Read port from ~/.claudestat/port (written by daemon on startup). Fallback: 7337.
let DAEMON_PORT = 7337
try {
  const portFile = require('path').join(os.homedir(), '.claudestat', 'port')
  const raw = fs.readFileSync(portFile, 'utf8').trim()
  const parsed = parseInt(raw, 10)
  if (!isNaN(parsed) && parsed >= 1024 && parsed <= 65535) DAEMON_PORT = parsed
} catch {}

const DAEMON_URL     = `http://localhost:${DAEMON_PORT}/event`

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

  // Para PreToolUse: enviamos el evento Y leemos el archivo de pausa local.
  // Si existe pause.signal, mostramos warning y salimos según killSwitchForce.
  if (eventType === 'PreToolUse') {
    fetch(DAEMON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    }).catch(() => null)

    // Check pause signal file (written by daemon when quota threshold reached)
    const signalFile = require('path').join(os.homedir(), '.claudestat', 'pause.signal')
    let signalMsg = null
    try { signalMsg = fs.readFileSync(signalFile, 'utf8').trim() } catch {}

    if (signalMsg) {
      process.stderr.write(`\n⚠️  claudestat — quota warning\n`)
      process.stderr.write(`   ${signalMsg}\n`)

      // Read config to check killSwitchForce
      let forceBlock = false
      try {
        const cfgPath = require('path').join(os.homedir(), '.claudestat', 'config.json')
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
        forceBlock = cfg.killSwitchForce === true
      } catch {}

      if (forceBlock) {
        process.stderr.write(`   Blocked (killSwitchForce is enabled). Run: claudestat resume\n\n`)
        process.exit(2)
      } else {
        process.stderr.write(`   Continuing. To pause manually: claudestat resume (removes signal)\n\n`)
        process.exit(0)
      }
    } else {
      process.exit(0)
    }

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
