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

import { Command }   from 'commander'
import fs            from 'fs'
import path          from 'path'
import { execSync }  from 'child_process'
import { startDaemon }                  from './daemon'
import { startWatch }                   from './watch'
import { installHooks, uninstallHooks } from './install'
import { readConfig, writeConfig }      from './config'
import type { ClaudestatConfig }        from './config'
import { runDoctor }                    from './doctor'

const program  = new Command()
const PID_FILE = path.join(process.env.HOME!, '.claudestat', 'daemon.pid')

// Warn if the active binary is outside the current npm global prefix (NVM conflict)
if (process.env.NVM_DIR) {
  try {
    const npmPrefix  = execSync('npm prefix -g', { stdio: 'pipe' }).toString().trim()
    const runningFrom = process.argv[1]
    if (runningFrom && !runningFrom.startsWith(npmPrefix)) {
      process.stderr.write(
        `\x1b[33m⚠️  claudestat is running from ${runningFrom}\x1b[0m\n` +
        `   This binary may not match the active Node version (${process.version}).\n` +
        `   Fix: \x1b[36mnvm use default && npm install -g @deibygs/claudestat\x1b[0m\n` +
        `   Then restart your terminal or run: \x1b[36mhash -r claudestat\x1b[0m\n\n`
      )
    }
  } catch {}
}

program
  .name('claudestat')
  .description('Real-time execution trace and cost intelligence for Claude Code')
  .version('0.2.1')

program
  .command('start')
  .description('Start the background daemon (receives Claude Code hook events)')
  .action(startDaemon)

program
  .command('watch')
  .description('Live terminal trace view')
  .action(() => startWatch().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program
  .command('install')
  .description('Install hooks into Claude Code (~/.claude/settings.json)')
  .action(installHooks)

program
  .command('uninstall')
  .description('Remove hooks from Claude Code')
  .action(uninstallHooks)

program
  .command('status')
  .description('Show current quota, cost and burn rate')
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
        `  Quota 5h    ${pctColor}${q.cyclePrompts}/${q.cycleLimit} prompts (${q.cyclePct}%)${R}  │  resets in ${resetLabel}\n` +
        `  Plan        ${q.detectedPlan.toUpperCase()}\n` +
        `  Sonnet      ${q.weeklyHoursSonnet}h / ${q.weeklyLimitSonnet}h  this week\n` +
        (q.weeklyLimitOpus > 0
          ? `  Opus        ${q.weeklyHoursOpus}h / ${q.weeklyLimitOpus}h  this week\n`
          : '') +
        `${burnLabel ? `  Burn rate  ${q.burnRateTokensPerMin.toLocaleString()} tok/min\n` : ''}` +
        `──────────────────────────────────────────\n`
      )
    } catch {
      console.error('\n❌ Daemon is not running. Start it with: claudestat start\n')
      process.exit(1)
    }
  })

program
  .command('config')
  .description('View or edit configuration (~/.claudestat/config.json)')
  .option('--kill-switch <bool>',  'Enable/disable kill switch: true|false')
  .option('--threshold <number>',  'Quota percentage to trigger the kill switch (default: 95)')
  .option('--plan <plan>',         'Force plan detection: pro|max5|max20|auto')
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
      else console.warn('  ⚠️  threshold must be a number between 1 and 100')
    }
    if (opts.plan !== undefined) {
      if (['pro', 'max5', 'max20', 'auto'].includes(opts.plan)) {
        cfg.plan = opts.plan === 'auto' ? null : opts.plan as ClaudestatConfig['plan']
        changed = true
      } else {
        console.warn('  ⚠️  plan must be: pro | max5 | max20 | auto')
      }
    }

    if (changed) {
      writeConfig(cfg)
      console.log('✅ Config saved to ~/.claudestat/config.json')
    }

    // Always show current config
    console.log('\n📋 Current config:')
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

program
  .command('doctor')
  .description('Check installation health and diagnose common issues')
  .action(() => runDoctor().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program.parse()
