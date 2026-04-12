/**
 * install.ts — Instalador de hooks en Claude Code
 *
 * Claude Code permite definir hooks en ~/.claude/settings.json.
 * Este comando modifica ese archivo para agregar nuestros hooks
 * sin pisar los que ya existan.
 *
 * IMPORTANTE: Hacemos un backup antes de modificar.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
const CLAUDETRACE_DIR = path.join(os.homedir(), '.claudetrace')
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')
const HOOKS_DIR       = path.join(CLAUDETRACE_DIR, 'hooks')
const HOOK_SCRIPT     = path.join(HOOKS_DIR, 'event.js')

function installHookScript() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true })

  // El script original está en el paquete junto a este archivo
  const source = path.join(__dirname, '..', 'hooks', 'event.js')
  fs.copyFileSync(source, HOOK_SCRIPT)
  fs.chmodSync(HOOK_SCRIPT, 0o755)

  console.log(`✓ Hook script instalado → ${HOOK_SCRIPT}`)
}

function hookEntry(eventType: string, matcher = '.*') {
  return {
    matcher,
    hooks: [{
      type: 'command',
      // Usamos el path absoluto para que funcione desde cualquier directorio
      command: `node "${HOOK_SCRIPT}" ${eventType}`
    }]
  }
}

export function installHooks() {
  installHookScript()

  // Leer settings.json existente
  let settings: Record<string, any> = {}
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
  } catch {
    console.error(`\n❌ No se pudo leer ${CLAUDE_SETTINGS}`)
    console.error('   Asegurate de que Claude Code esté instalado.\n')
    process.exit(1)
  }

  // Backup antes de modificar
  const backupPath = CLAUDE_SETTINGS + '.bak'
  fs.copyFileSync(CLAUDE_SETTINGS, backupPath)
  console.log(`✓ Backup creado → ${backupPath}`)

  if (!settings.hooks) settings.hooks = {}

  const hookTypes = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']
  let added = 0

  for (const hookType of hookTypes) {
    if (!settings.hooks[hookType]) settings.hooks[hookType] = []

    // Verificar si ya existe un hook de claudetrace para este tipo
    const exists = settings.hooks[hookType].some((entry: any) =>
      entry.hooks?.some((h: any) => typeof h.command === 'string' && h.command.includes('claudetrace'))
    )

    if (!exists) {
      settings.hooks[hookType].push(hookEntry(hookType))
      console.log(`✓ Hook configurado: ${hookType}`)
      added++
    } else {
      console.log(`  (ya instalado): ${hookType}`)
    }
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))

  if (added > 0) {
    console.log(`\n✅ ${added} hooks instalados.`)
    console.log('   Reiniciá Claude Code para activarlos.\n')
  } else {
    console.log('\n✅ Todos los hooks ya estaban instalados.\n')
  }
}

export function uninstallHooks() {
  let settings: Record<string, any> = {}
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
  } catch {
    console.error('No se pudo leer settings.json')
    process.exit(1)
  }

  if (!settings.hooks) {
    console.log('No hay hooks instalados.')
    return
  }

  let removed = 0
  for (const hookType of Object.keys(settings.hooks)) {
    const before = settings.hooks[hookType].length
    settings.hooks[hookType] = settings.hooks[hookType].filter((entry: any) =>
      !entry.hooks?.some((h: any) => typeof h.command === 'string' && h.command.includes('claudetrace'))
    )
    removed += before - settings.hooks[hookType].length
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))
  console.log(`✅ ${removed} hooks de claudetrace eliminados.`)
  console.log('   Reiniciá Claude Code para que tome efecto.\n')
}
