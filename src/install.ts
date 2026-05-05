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
import { getClaudeDir, getClaudestatDir, isWindows } from './paths'

const CLAUDESTAT_DIR = getClaudestatDir()
const CLAUDE_SETTINGS = path.join(getClaudeDir(), 'settings.json')
const HOOKS_DIR       = path.join(CLAUDESTAT_DIR, 'hooks')
const HOOK_SCRIPT     = path.join(HOOKS_DIR, 'event.js')

function installHookScript() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true })

  // El script original está en el paquete junto a este archivo
  const source = path.join(__dirname, '..', 'hooks', 'event.js')
  fs.copyFileSync(source, HOOK_SCRIPT)
  if (!isWindows) {
    fs.chmodSync(HOOK_SCRIPT, 0o755)
  }

  console.log(`✓ Hook script installed → ${HOOK_SCRIPT}`)
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
    console.error(`\n❌ Could not read ${CLAUDE_SETTINGS}`)
    console.error('   Make sure Claude Code is installed.\n')
    process.exit(1)
  }

  // Backup antes de modificar
  const backupPath = CLAUDE_SETTINGS + '.bak'
  fs.copyFileSync(CLAUDE_SETTINGS, backupPath)
  console.log(`✓ Backup created → ${backupPath}`)

  if (!settings.hooks) settings.hooks = {}

  const hookTypes = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']
  let added = 0

  for (const hookType of hookTypes) {
    if (!settings.hooks[hookType]) settings.hooks[hookType] = []

    // Verificar si ya existe un hook de claudestat para este tipo
    const exists = settings.hooks[hookType].some((entry: any) =>
      entry.hooks?.some((h: any) => typeof h.command === 'string' && h.command.includes('claudestat'))
    )

    if (!exists) {
      settings.hooks[hookType].push(hookEntry(hookType))
      console.log(`✓ Hook configured: ${hookType}`)
      added++
    } else {
      console.log(`  (already installed): ${hookType}`)
    }
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))

  if (added > 0) {
    console.log(`\n✅ ${added} hooks installed.`)
    console.log('   Restart Claude Code to activate them.\n')
  } else {
    console.log('\n✅ All hooks already installed.\n')
  }
}

export function uninstallHooks() {
  let settings: Record<string, any> = {}
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
  } catch {
    console.error('Could not read settings.json')
    process.exit(1)
  }

  if (!settings.hooks) {
    console.log('No hooks installed.')
    return
  }

  let removed = 0
  for (const hookType of Object.keys(settings.hooks)) {
    const before = settings.hooks[hookType].length
    settings.hooks[hookType] = settings.hooks[hookType].filter((entry: any) =>
      !entry.hooks?.some((h: any) => typeof h.command === 'string' && h.command.includes('claudestat'))
    )
    removed += before - settings.hooks[hookType].length
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))
  console.log(`✅ ${removed} claudestat hooks removed.`)
  console.log('   Restart Claude Code for changes to take effect.\n')
}
