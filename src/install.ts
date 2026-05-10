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
import readline from 'readline'
import { getClaudeDir, getClaudestatDir, isWindows } from './paths'
import { readConfig, writeConfig } from './config'

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

    const exists = settings.hooks[hookType].some(hasClaudestatHook)

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

const CONFIG_PATH = path.join(CLAUDESTAT_DIR, 'config.json')

function hasClaudestatHook(entry: any): boolean {
  return entry.hooks?.some((h: any) => typeof h.command === 'string' && h.command.includes('claudestat'))
}

export async function runInstall(): Promise<void> {
  if (!fs.existsSync(CONFIG_PATH)) {
    await runWizard()
  } else {
    showInstallStatus()
  }
}

export async function runWizard(): Promise<void> {
  const nonInteractive = !process.stdin.isTTY

  console.log('\n╔═══════════════════════════════════════════╗')
  console.log('║        claudestat — First Install         ║')
  console.log('╚═══════════════════════════════════════════╝\n')
  console.log('claudestat hooks into Claude Code to capture:')
  console.log('  • Tool calls (name, duration, input/output)')
  console.log('  • Token usage and costs per session')
  console.log('  • Quota consumption (5h rolling window)\n')
  console.log('It modifies ~/.claude/settings.json to add lifecycle hooks.')
  console.log('A backup is created before any change.\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    // Paso 1: confirmación
    if (!nonInteractive) {
      const answer = await new Promise<string>(resolve => rl.question('Continue with installation? [Y/n] ', resolve))
      if (answer.trim().toLowerCase() === 'n') {
        console.log('\nInstallation cancelled.\n')
        return
      }
    }

    // Paso 2: verificar versión de Node
    const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10)
    if (nodeMajor < 22) {
      console.log(`\n⚠  Node.js ${process.version} detected — claudestat requires Node ≥ 22.`)
      console.log('   Some features may not work correctly.\n')
    } else {
      console.log(`✓ Node.js ${process.version}`)
    }

    // Paso 3: selección de plan
    let plan: string = 'pro'
    if (!nonInteractive) {
      console.log('\nSelect your Claude plan:')
      console.log('  1) free   2) pro (default)   3) max5   4) max20')
      const input = await new Promise<string>(resolve => rl.question('Plan [1-4, default: 2]: ', resolve))
      const planMap: Record<string, string> = { '1': 'free', '2': 'pro', '3': 'max5', '4': 'max20' }
      plan = planMap[input.trim()] ?? 'pro'
    }
    console.log(`✓ Plan: ${plan}`)

    // Paso 4: crear config inicial
    const cfg = readConfig()
    writeConfig({ ...cfg, plan: plan as any })
    console.log(`✓ Config created → ${CONFIG_PATH}\n`)
  } finally {
    rl.close()
  }

  // Paso 5: instalar hooks
  installHooks()
}

export function showInstallStatus(): void {
  const cfg = readConfig()

  console.log('\n╔═══════════════════════════════════════════╗')
  console.log('║         claudestat — Status               ║')
  console.log('╚═══════════════════════════════════════════╝\n')
  console.log('✅ Already installed. Current config:\n')
  console.log(`   plan:                ${cfg.plan ?? 'auto-detect'}`)
  console.log(`   killSwitchEnabled:   ${cfg.killSwitchEnabled}`)
  console.log(`   killSwitchThreshold: ${cfg.killSwitchThreshold}%`)

  // Verificar si los hooks están en settings.json
  let hooksOk = false
  try {
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
    hooksOk = Object.values(settings.hooks ?? {})
      .flat()
      .some(hasClaudestatHook)
  } catch {}

  console.log(`\n   hooks in settings.json: ${hooksOk ? '✅ installed' : '❌ not found'}`)
  if (!hooksOk) {
    console.log('\n   Run `claudestat install` again to reinstall hooks.\n')
  } else {
    console.log('')
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
    settings.hooks[hookType] = settings.hooks[hookType].filter((entry: any) => !hasClaudestatHook(entry))
    removed += before - settings.hooks[hookType].length
  }

  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2))
  console.log(`✅ ${removed} claudestat hooks removed.`)
  console.log('   Restart Claude Code for changes to take effect.\n')
}
