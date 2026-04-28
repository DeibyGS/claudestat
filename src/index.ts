#!/usr/bin/env node
/**
 * index.ts — Entry point del CLI
 *
 * Suprimimos el ExperimentalWarning de node:sqlite antes de importar nada.
 * El módulo funciona perfectamente — el warning es solo informativo.
 */

// Filtrar solo el warning de SQLite, dejar pasar el resto
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && w.message.includes('SQLite')) return
  process.stderr.write(`${w.name}: ${w.message}\n`)
})

import { Command } from 'commander'
import fs         from 'fs'
import path       from 'path'
import { startDaemon }              from './daemon'
import { startWatch }               from './watch'
import { installHooks, uninstallHooks } from './install'
import { readConfig, writeConfig }  from './config'
import type { ClaudetraceConfig }   from './config'

const program = new Command()
const PID_FILE = path.join(process.env.HOME!, '.claudestat', 'daemon.pid')

program
  .name('claudestat')
  .description('Real-time execution trace and cost intelligence for Claude Code')
  .version('0.1.1')

program
  .command('start')
  .description('Iniciar el daemon (recibe eventos de Claude Code en background)')
  .action(startDaemon)

program
  .command('watch')
  .description('Ver el trace de ejecución en tiempo real en la terminal')
  .action(() => startWatch().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program
  .command('install')
  .description('Instalar los hooks de claudestat en Claude Code (~/.claude/settings.json)')
  .action(installHooks)

program
  .command('uninstall')
  .description('Eliminar los hooks de claudestat de Claude Code')
  .action(uninstallHooks)

program
  .command('status')
  .description('Mostrar estado actual de cuota, coste y burn rate (desde el daemon)')
  .action(async () => {
    try {
      const [quotaRes, healthRes] = await Promise.all([
        fetch('http://localhost:7337/quota'),
        fetch('http://localhost:7337/health'),
      ])
      if (!quotaRes.ok) throw new Error('Daemon no disponible')

      const q    = await quotaRes.json() as any
      const _h   = await healthRes.json().catch(() => ({})) as any

      // Colores ANSI
      const R = '\x1b[0m'
      const pctColor = q.cyclePct >= 95 ? '\x1b[31m'   // rojo
        : q.cyclePct >= 85 ? '\x1b[33m'                  // naranja
        : q.cyclePct >= 70 ? '\x1b[33m'                  // amarillo
        : '\x1b[32m'                                      // verde

      const resetMin   = Math.ceil(q.cycleResetMs / 60_000)
      const resetLabel = resetMin >= 60
        ? `${Math.floor(resetMin / 60)}h ${resetMin % 60}m`
        : `${resetMin}m`

      const burnLabel = q.burnRateTokensPerMin > 0
        ? ` │ 🔥 ${q.burnRateTokensPerMin.toLocaleString()} tok/min`
        : ''

      console.log(
        `\n📊 claudestat status\n` +
        `──────────────────────────────────────────\n` +
        `  Cuota 5h   ${pctColor}${q.cyclePrompts}/${q.cycleLimit} prompts (${q.cyclePct}%)${R}  │  reset en ${resetLabel}\n` +
        `  Plan        ${q.detectedPlan.toUpperCase()}\n` +
        `  Sonnet      ${q.weeklyHoursSonnet}h / ${q.weeklyLimitSonnet}h  esta semana\n` +
        (q.weeklyLimitOpus > 0
          ? `  Opus        ${q.weeklyHoursOpus}h / ${q.weeklyLimitOpus}h  esta semana\n`
          : '') +
        `${burnLabel ? `  Burn rate  ${q.burnRateTokensPerMin.toLocaleString()} tok/min\n` : ''}` +
        `──────────────────────────────────────────\n`
      )
    } catch {
      console.error('\n❌ El daemon no está corriendo. Inicialo con: claudestat start\n')
      process.exit(1)
    }
  })

program
  .command('config')
  .description('Ver o editar la configuración de claudestat (~/.claudestat/config.json)')
  .option('--kill-switch <bool>',  'Activar/desactivar kill switch: true|false')
  .option('--threshold <number>',  'Porcentaje de cuota para activar el kill switch (default: 95)')
  .option('--plan <plan>',         'Forzar plan: pro|max5|max20|auto')
  .action((opts) => {
    const cfg = readConfig()
    let changed = false

    if (opts.killSwitch !== undefined) {
      cfg.killSwitchEnabled = opts.killSwitch === 'true'
      changed = true
    }
    if (opts.threshold !== undefined) {
      const t = parseInt(opts.threshold, 10)
      if (!isNaN(t) && t > 0 && t <= 100) { cfg.killSwitchThreshold = t; changed = true }
      else console.warn('  ⚠️  threshold debe ser un número entre 1 y 100')
    }
    if (opts.plan !== undefined) {
      if (['pro', 'max5', 'max20', 'auto'].includes(opts.plan)) {
        cfg.plan = opts.plan === 'auto' ? null : opts.plan as ClaudetraceConfig['plan']
        changed = true
      } else {
        console.warn('  ⚠️  plan debe ser: pro | max5 | max20 | auto')
      }
    }

    if (changed) {
      writeConfig(cfg)
      console.log('✅ Config guardada en ~/.claudestat/config.json')
    }

    // Mostrar config actual siempre
    console.log('\n📋 Configuración actual:')
    console.log(`   killSwitchEnabled:  ${cfg.killSwitchEnabled}`)
    console.log(`   killSwitchThreshold: ${cfg.killSwitchThreshold}%`)
    console.log(`   warnThresholds:     ${cfg.warnThresholds.join('%, ')}%`)
    console.log(`   plan:               ${cfg.plan ?? 'auto-detect'}\n`)
  })

program
  .command('stop')
  .description('Stop the claudestat daemon')
  .action(() => {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
      process.kill(pid, 'SIGTERM')
      console.log(`✅ claudestat daemon stopped (pid ${pid})`)
    } catch (e: any) {
      if (e.code === 'ENOENT') console.error('❌ Daemon is not running (no PID file found)')
      else if (e.code === 'ESRCH') console.error('❌ Daemon process not found — stale PID file removed')
      else console.error('❌ Error stopping daemon:', e.message)
      try { fs.unlinkSync(PID_FILE) } catch {}
      process.exit(1)
    }
  })

program
  .command('restart')
  .description('Restart the claudestat daemon')
  .action(async () => {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
      process.kill(pid, 'SIGTERM')
      console.log(`  Stopped pid ${pid}, restarting…`)
      await new Promise(r => setTimeout(r, 800))
    } catch {
      console.log('  Daemon was not running, starting fresh…')
    }
    startDaemon()
  })

program.parse()
