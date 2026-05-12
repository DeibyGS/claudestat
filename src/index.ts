#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
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

import { Command }              from 'commander'
import fs                       from 'fs'
import path                     from 'path'
import { execSync, spawn }      from 'child_process'
import { startDaemon }                  from './daemon'
import { startWatchdog }                from './watchdog'
import { startWatch }                   from './watch'
import { runInstall, uninstallHooks } from './install'
import { runExport } from './export'
import { readConfig, writeConfig }      from './config'
import type { ClaudestatConfig }        from './config'
import { runDoctor }                    from './doctor'
import { runShare }                   from './share'
import { runRoast }                  from './roast'
import { getWeeklyInsightData, renderWeeklyInsight, getUsageInsights, renderInsights } from './insights'
import { getPidFile, whichCmd, isWindows } from './paths'
import { refreshFromApi } from './quota-tracker'

const program  = new Command()
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
const PID_FILE = getPidFile()

function spawnDaemon() {
  const child = spawn(process.execPath, [process.argv[1], 'start'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CLAUDESTAT_DAEMON: '1' },
  })
  child.unref()
  console.log(`✅ claudestat daemon started (pid ${child.pid})`)
  console.log(`   Dashboard → http://localhost:7337`)
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE) } catch {}
}

async function stopDaemon(): Promise<void> {
  try {
    const res = await fetch('http://localhost:7337/shutdown', {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      console.log('✅ claudestat daemon stopped')
      removePidFile()
      return
    }
  } catch {}

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (process.platform === 'win32') {
      process.kill(pid)
    } else {
      process.kill(pid, 'SIGTERM')
    }
    console.log(`✅ claudestat daemon stopped (pid ${pid})`)
    removePidFile()
  } catch (e: any) {
    removePidFile()
    if (e.code === 'ENOENT') throw new Error('Daemon is not running (no PID file found)')
    if (e.code === 'ESRCH') throw new Error('Daemon process not found — stale PID file removed')
    throw new Error(`Error stopping daemon: ${e.message}`)
  }
}

// Warn if the active binary is outside the current npm global prefix (NVM conflict)
if (process.env.NVM_DIR || process.env.NVM_HOME) {
  try {
    const npmPrefix  = execSync('npm prefix -g', { stdio: 'pipe' }).toString().trim()
    const runningFrom = process.argv[1]
    if (runningFrom && !runningFrom.startsWith(npmPrefix)) {
      const refreshCmd = isWindows ? 'refreshenv' : 'hash -r claudestat'
      process.stderr.write(
        `\x1b[33m⚠️  claudestat is running from ${runningFrom}\x1b[0m\n` +
        `   This binary may not match the active Node version (${process.version}).\n` +
        `   Fix: \x1b[36mnvm use default && npm install -g @deibygs/claudestat\x1b[0m\n` +
        `   Then restart your terminal or run: \x1b[36m${refreshCmd}\x1b[0m\n\n`
      )
    }
  } catch {}
}

program
  .name('claudestat')
  .description('Real-time execution trace and cost intelligence for Claude Code')
  .version(PKG_VERSION)

program
  .command('start')
  .description('Start the background daemon (receives Claude Code hook events)')
  .option('--watchdog', 'Auto-restart daemon if it crashes')
  .action((opts) => {
    if (process.env.CLAUDESTAT_DAEMON) {
      startDaemon()
      if (opts.watchdog) startWatchdog()
    } else {
      spawnDaemon()
      process.exit(0)
    }
  })

program
  .command('watch')
  .description('Live terminal trace view')
  .action(() => startWatch().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program
  .command('install')
  .description('Install hooks into Claude Code settings')
  .action(runInstall)

program
  .command('uninstall')
  .description('Remove hooks from Claude Code')
  .action(uninstallHooks)

program
  .command('export [format]')
  .description('Export session data (json | csv, default: json). Max 500 sessions.')
  .option('--from <date>', 'Start date YYYY-MM-DD (inclusive)')
  .option('--to <date>',   'End date YYYY-MM-DD (inclusive)')
  .option('--project <name>', 'Filter by project path (case-insensitive substring)')
  .option('--output <path>',  'Write to file instead of stdout')
  .action((format: string | undefined, opts) => {
    const fmt = (format ?? 'json').toLowerCase()
    if (fmt !== 'json' && fmt !== 'csv') {
      console.error('Error: format must be "json" or "csv"')
      process.exit(1)
    }
    runExport({ format: fmt as 'json' | 'csv', ...opts })
    process.exit(0)
  })

program
  .command('status')
  .description('Show current quota, cost and burn rate')
  .option('--json', 'Output raw JSON instead of formatted text')
  .option('--compact', 'One-line output for tmux')
  .action(async (opts) => {
    try {
      await refreshFromApi()  // refresh disk cache on demand; daemon reads from disk
      const [quotaRes, healthRes] = await Promise.all([
        fetch('http://localhost:7337/quota'),
        fetch('http://localhost:7337/health'),
      ])
      if (!quotaRes.ok) throw new Error('Daemon unavailable')

      const q    = await quotaRes.json() as any
      const _h   = await healthRes.json().catch(() => ({})) as any

      if (opts.compact) {
        const pctCycle = q.cyclePct
        const cycleEmoji = pctCycle >= 95 ? '🔴' : pctCycle >= 70 ? '🟡' : '🟢'
        const wEmoji = q.weeklyPctAll >= 95 ? '🔴' : q.weeklyPctAll >= 70 ? '🟡' : '🟢'
        
        console.log(`C:${pctCycle}%${cycleEmoji} W:${q.weeklyPctAll}%${wEmoji} ${q.detectedPlan}`)
        process.exit(0)
      }

      if (opts.json) {
        console.log(JSON.stringify({
          cyclePrompts: q.cyclePrompts,
          cycleLimit:   q.cycleLimit,
          cyclePct:     q.cyclePct,
          cycleResetMs: q.cycleResetMs,
          plan:         q.detectedPlan,
          weeklyHoursSonnet: q.weeklyHoursSonnet,
          weeklyLimitSonnet: q.weeklyLimitSonnet,
          weeklyHoursOpus:   q.weeklyHoursOpus,
          weeklyLimitOpus:   q.weeklyLimitOpus,
          weeklyPctAll:      q.weeklyPctAll,
          burnRateTokensPerMin: q.burnRateTokensPerMin,
        }))
        process.exit(0)
      }

      const R  = '\x1b[0m'
      const B  = '\x1b[1m'
      const D  = '\x1b[2m'

      const pctBar = (pct: number, width = 20): string => {
        const filled = Math.round(Math.min(pct, 100) / 100 * width)
        const color  = pct >= 90 ? '\x1b[31m' : pct >= 70 ? '\x1b[33m' : '\x1b[32m'
        return `${color}${'█'.repeat(filled)}${R}${D}${'░'.repeat(width - filled)}${R}`
      }

      const resetTime = q.cycleResetAt
        ? new Date(q.cycleResetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : (() => {
            const m = Math.ceil(q.cycleResetMs / 60_000)
            return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
          })()

      const now = new Date()
      const daysToMonday = ((8 - now.getDay()) % 7) || 7
      const nextMonday   = new Date(now); nextMonday.setDate(now.getDate() + daysToMonday)
      const weekReset    = nextMonday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

      const lines: string[] = []
      lines.push(`\n${B}📊 claudestat${R}  ${D}${q.detectedPlan.toUpperCase()} plan${R}`)
      lines.push('━'.repeat(42))
      lines.push('')
      lines.push(`  5h    ${pctBar(q.cyclePct)}  ${B}${q.cyclePct}%${R}   ${D}resets ${resetTime}${R}`)
      lines.push(`  Week  ${pctBar(q.weeklyPctAll)}  ${B}${q.weeklyPctAll}%${R}   ${D}resets ${weekReset}${R}`)

      if (q.weeklyLimitOpus > 0) {
        lines.push('')
        lines.push(`  ${D}  ├─ Sonnet  ${q.weeklyHoursSonnet}h / ${q.weeklyLimitSonnet}h${R}`)
        lines.push(`  ${D}  └─ Opus    ${q.weeklyHoursOpus}h / ${q.weeklyLimitOpus}h${R}`)
      }

      if (q.burnRateTokensPerMin > 0) {
        lines.push('')
        lines.push(`  🔥 ${B}${q.burnRateTokensPerMin.toLocaleString()}${R} tok/min  ${D}·  ${q.cyclePrompts} prompts used${R}`)
      }

      lines.push('')
      lines.push('━'.repeat(42))
      lines.push('')
      console.log(lines.join('\n'))
      process.exit(0)
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
  .option('--alerts <bool>',       'Enable/disable daemon rate limit alerts: true|false')
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
    if (opts.alerts !== undefined) {
      cfg.alertsEnabled = opts.alerts === 'true'
      changed = true
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
    console.log(`   alertsEnabled:      ${cfg.alertsEnabled}`)
    console.log(`   plan:               ${cfg.plan ?? 'auto-detect'}\n`)
    process.exit(0)
  })

program
  .command('stop')
  .description('Stop the claudestat daemon')
  .action(async () => {
    await stopDaemon().catch((e: Error) => { console.error(`❌ ${e.message}`); process.exit(1) })
    process.exit(0)
  })

program
  .command('restart')
  .description('Restart the claudestat daemon')
  .action(async () => {
    setTimeout(() => process.exit(0), 5000).unref()
    await stopDaemon().catch(() => { console.log('  Daemon was not running, starting fresh…') })
    await new Promise(r => setTimeout(r, 500))
    spawnDaemon()
    process.exit(0)
  })

program
  .command('top')
  .description('Rank tools by cost, frequency, or duration')
  .option('--by <metric>',    'Sort by: cost, count, duration (default: cost)')
  .option('--limit <number>', 'Number of tools to show (default: 10)')
  .option('--days <number>',  'Look back N days (default: 30)')
  .action(async (opts) => {
    try {
      const by    = opts.by ?? 'cost'
      const limit = opts.limit ?? 10
      const days  = opts.days ?? 30
      const url   = `http://localhost:7337/api/top?by=${by}&limit=${limit}&days=${days}`
      const res   = await fetch(url)
      if (!res.ok) throw new Error('Daemon unavailable')
      const data  = await res.json() as any

      const label = by === 'count' ? 'calls' : by === 'duration' ? 'duration' : 'est. cost'
      console.log(`\n🏆 claudestat top — by ${label} (last ${days} days)\n`)
      console.log('  #  Tool              Calls    Duration   Est. Cost      %')
      console.log('  ── ───────────────── ──────── ───────────── ───────── ────')
      for (let i = 0; i < data.tools.length; i++) {
        const t = data.tools[i]
        const isOther = t.tool === 'Other'
        const dur = isOther ? '—'
          : t.totalDurationMs >= 60_000
          ? `${(t.totalDurationMs / 60_000).toFixed(1)}m`
          : `${(t.totalDurationMs / 1000).toFixed(0)}s`
        const cost = t.estimatedCostUsd < 0.01
          ? `$${t.estimatedCostUsd.toFixed(4)}`
          : `$${t.estimatedCostUsd.toFixed(2)}`
        const pct = by === 'cost' ? `${t.pctCost}%` : isOther ? '' : `${t.pctCount}%`
        const countStr = isOther ? '—' : String(t.count)
        console.log(`  ${(i + 1).toString().padStart(2)}  ${t.tool.padEnd(18)} ${countStr.padStart(8)} ${dur.padStart(13)} ${cost.padStart(9)} ${pct.padStart(4)}`)
      }
      console.log()
      process.exit(0)
    } catch {
      console.error('\n❌ Daemon is not running. Start it with: claudestat start\n')
      process.exit(1)
    }
  })

program
  .command('doctor')
  .description('Check installation health and diagnose common issues')
  .action(() => runDoctor().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  }))

program
  .command('share [session-id]')
  .description('Generate a shareable session card (ASCII or JSON)')
  .option('--format <type>', 'Output format: ascii, json (default: ascii)')
  .option('--copy', 'Copy to clipboard (macOS only)')
  .action(async (sessionId: string | undefined, opts) => {
    try {
      const format = (opts.format ?? 'ascii') as 'ascii' | 'json'
      const copy = !!opts.copy
      await runShare({ sessionId, format, copy })
      process.exit(0)
    } catch (err: any) {
      console.error('\n❌ Error:', err.message)
      process.exit(1)
    }
  })

program
  .command('roast')
  .description('Roast your Claude Code usage habits')
  .option('--stats', 'Show raw stats only, no roast')
  .option('--months <n>', 'Look back N months (default: 1)', String, '1')
  .action(async (opts) => {
    try {
      const months = parseInt(opts.months || '1', 10)
      await runRoast({ stats: !!opts.stats, months })
      process.exit(0)
    } catch (err: any) {
      console.error('\n❌ Error:', err.message)
      process.exit(1)
    }
  })

program
  .command('weekly')
  .description('Show weekly usage summary')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const data = getWeeklyInsightData()
      if (data.total_sessions === 0) {
        console.log('\n📊 No usage data yet — start using Claude Code and claudestat will track it.\n')
        process.exit(0)
      }
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
        process.exit(0)
      }
      console.log(renderWeeklyInsight(data))
      process.exit(0)
    } catch (err: any) {
      console.error('\n❌ Error:', err.message)
      process.exit(1)
    }
  })

program
  .command('insights')
  .description('Show usage insights: cost breakdown, cache savings, efficiency trend, peak hours')
  .option('--days <number>', 'Look back N days (default 7)')
  .option('--json', 'Output raw JSON')
  .action((opts) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(opts.days ?? '7', 10) || 7))
      const data = getUsageInsights(days)
      if (data.total_sessions === 0) {
        console.log(`\n💡 No data for the last ${days} days.\n`)
        process.exit(0)
      }
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
        process.exit(0)
      }
      console.log(renderInsights(data))
      process.exit(0)
    } catch (err: any) {
      console.error('\n❌ Error:', err.message)
      process.exit(1)
    }
  })

program.parse()
