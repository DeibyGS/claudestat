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
import { runInstall, uninstallHooks, installHooks } from './install'
import { installService, uninstallService } from './service'
import { runExport } from './export'
import { readConfig, writeConfig }      from './config'
import type { ClaudestatConfig }        from './config'
import { runDoctor }                    from './doctor'
import { runRoast }                  from './roast'
import { getWeeklyInsightData, renderWeeklyInsight, getUsageInsights, renderInsights } from './insights'
import { getPidFile, whichCmd, isWindows, getClaudestatDir } from './paths'
import { refreshFromApi } from './quota-tracker'

const program  = new Command()
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
const PID_FILE = getPidFile()

// ── Update notifier ────────────────────────────────────────────
const SKIP_UPDATE_NOTICE = new Set(['start', 'stop', 'restart', 'watch'])
const subcommand = process.argv[2]

if (!SKIP_UPDATE_NOTICE.has(subcommand)) {
  const UPDATE_CACHE = path.join(getClaudestatDir(), 'update-cache.json')
  let cachedLatest: string | null = null

  const fetchLatestVersion = () => {
    fetch('https://registry.npmjs.org/@statforge/claudestat/latest', { signal: AbortSignal.timeout(3000) })
      .then(r => r.json() as Promise<any>)
      .then(j => {
        if (j?.version) {
          cachedLatest = j.version
          fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ version: j.version, ts: Date.now() }))
        }
      })
      .catch(() => {})
  }

  try {
    const cache = JSON.parse(fs.readFileSync(UPDATE_CACHE, 'utf8'))
    cachedLatest = cache.version
    if (Date.now() - cache.ts >= 24 * 60 * 60 * 1000) fetchLatestVersion()
  } catch {
    fetchLatestVersion()
  }

  const _exit = process.exit.bind(process)
  process.exit = ((code?: number) => {
    if ((code ?? 0) === 0 && cachedLatest && cachedLatest !== PKG_VERSION) {
      console.log(`\n  ✦ Update available: ${PKG_VERSION} → ${cachedLatest}`)
      console.log(`    Run: npm install -g @statforge/claudestat\n`)
    }
    _exit(code)
  }) as typeof process.exit
}

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

async function checkLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/@statforge/claudestat/latest', {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const json = await res.json() as any
    return json.version as string
  } catch {
    return null
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
        `   Fix: \x1b[36mnvm use default && npm install -g @statforge/claudestat\x1b[0m\n` +
        `   Then restart your terminal or run: \x1b[36m${refreshCmd}\x1b[0m\n\n`
      )
    }
  } catch {}
}

program
  .name('claudestat')
  .description('Real-time execution trace and cost intelligence for Claude Code · github.com/DeibyGS/claudestat')
  .version(PKG_VERSION)

program
  .command('version')
  .description('Show version and check for updates')
  .action(async () => {
    console.log(PKG_VERSION)
    const latest = await checkLatestVersion()
    if (latest) {
      const isLatest = latest === PKG_VERSION
      const tag = isLatest ? `\x1b[32mlatest ✓\x1b[0m` : `\x1b[33mlatest: ${latest} — run npm update\x1b[0m`
      console.log(`  ${tag}`)
    }
    process.exit(0)
  })

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
  .command('setup')
  .description('One-command setup: install hooks + register daemon as system service (auto-starts on login)')
  .option('--uninstall', 'Remove hooks and system service')
  .action(async (opts) => {
    if (opts.uninstall) {
      console.log('Uninstalling claudestat...')
      uninstallService()
      uninstallHooks()
      await stopDaemon().catch(() => {})
      console.log('✅ claudestat fully removed')
      process.exit(0)
    }
    console.log('Setting up claudestat...')
    installHooks()
    installService()
    console.log('✅ claudestat is running and will start automatically on login')
    console.log('   Dashboard → http://localhost:7337')
    process.exit(0)
  })

program
  .command('install')
  .description('Install hooks into Claude Code settings')
  .action(async () => { await runInstall(); process.exit(0) })

program
  .command('uninstall')
  .description('Remove hooks from Claude Code')
  .action(() => { uninstallHooks(); process.exit(0) })

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
      lines.push(`  5h      ${pctBar(q.cyclePct)}  ${B}${q.cyclePct}%${R}   ${D}resets ${resetTime}${R}`)
      lines.push('')
      lines.push(`  Week    ${pctBar(q.weeklyPctAll)}  ${B}${q.weeklyPctAll}%${R}   ${D}resets ${weekReset}${R}`)

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

    const R = '\x1b[0m'
    const B = '\x1b[1m'
    const D = '\x1b[2m'
    const G = '\x1b[32m'
    const Y = '\x1b[33m'
    const C = '\x1b[36m'

    const bar = (pct: number, width = 20): string => {
      const filled = Math.round(Math.min(pct, 100) / 100 * width)
      const color = pct >= 95 ? '\x1b[31m' : pct >= 85 ? '\x1b[33m' : '\x1b[32m'
      return `${color}${'█'.repeat(filled)}${R}${D}${'░'.repeat(width - filled)}${R}`
    }

    const planColor = cfg.plan === 'pro' ? G : cfg.plan === 'max5' ? C : cfg.plan === 'max20' ? '\x1b[35m' : Y
    const planLabel = cfg.plan ?? 'auto-detect'
    const alertsIcon = cfg.alertsEnabled ? `${G}enabled${R}` : `${Y}disabled${R}`

    const lines: string[] = []
    lines.push(`\n${B}⚙️  claudestat config${R}`)
    lines.push('━'.repeat(42))
    lines.push('')
    lines.push(`  Plan              ${planColor}${planLabel.toUpperCase()}${R}`)
    lines.push(`  Alerts            ${alertsIcon}`)
    lines.push('')
    lines.push(`  Kill switch       ${cfg.killSwitchEnabled ? `${Y}ON${R} at ${cfg.killSwitchThreshold}%` : `${D}OFF${R}`}`)
    if (cfg.killSwitchEnabled) {
      lines.push(`                    ${bar(cfg.killSwitchThreshold)}`)
    }
    lines.push('')
    lines.push(`  Cycle thresholds  ${cfg.warnThresholds.join('%, ')}%`)
    lines.push(`                    ${D}yellow${R} ${bar(cfg.warnThresholds[0], 8)}  ${D}orange${R} ${bar(cfg.warnThresholds[1], 8)}  ${D}red${R} ${bar(cfg.warnThresholds[2], 8)}`)
    lines.push('')
    lines.push('━'.repeat(42))
    lines.push('')
    console.log(lines.join('\n'))
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

      const R = '\x1b[0m'
      const B = '\x1b[1m'
      const D = '\x1b[2m'

      const label = by === 'count' ? 'calls' : by === 'duration' ? 'duration' : 'est. cost'
      const maxVal = Math.max(...data.tools.map((t: any) =>
        by === 'cost' ? t.estimatedCostUsd : by === 'count' ? t.count : t.totalDurationMs
      ))

      const bar = (val: number, max: number, width = 20): string => {
        const pct = max > 0 ? val / max * 100 : 0
        const filled = Math.round(pct / 100 * width)
        const rank = data.tools.findIndex((t: any) => {
          const tv = by === 'cost' ? t.estimatedCostUsd : by === 'count' ? t.count : t.totalDurationMs
          return tv === val
        })
        const color = rank === 0 ? '\x1b[31m' : rank <= 2 ? '\x1b[33m' : '\x1b[32m'
        return `${color}${'█'.repeat(filled)}${R}${D}${'░'.repeat(width - filled)}${R}`
      }

      const fmtCost = (n: number) => n < 0.01 ? `< $0.01` : `$${n.toFixed(2)}`
      const fmtDur = (ms: number) => ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(0)}s`
      const fmtPct = (n: number) => `${Math.round(n)}%`

      const lines: string[] = []
      lines.push(`\n${B}🏆 claudestat top${R}  ${D}by ${label} (last ${days} days)${R}`)
      lines.push('━'.repeat(52))
      lines.push('')

      for (let i = 0; i < data.tools.length; i++) {
        const t = data.tools[i]
        const isOther = t.tool === 'Other'
        const val = isOther ? 0 : (by === 'cost' ? t.estimatedCostUsd : by === 'count' ? t.count : t.totalDurationMs)
        const pct = by === 'cost' ? t.pctCost : (isOther ? 0 : t.pctCount)
        const dur = isOther ? '—' : fmtDur(t.totalDurationMs)
        const cost = isOther ? fmtCost(t.estimatedCostUsd) : fmtCost(t.estimatedCostUsd)
        const countStr = isOther ? '—' : String(t.count)
        const toolName = (t.tool.length > 18 ? t.tool.slice(0, 16) + '…' : t.tool).padEnd(18)

        if (isOther) {
          lines.push(`  ${D}Other${R}  ${'—'.padStart(20)}  ${cost.padStart(10)}  ${fmtPct(pct)}`)
        } else {
          lines.push(`  ${B}${(i + 1).toString().padStart(2)}${R}  ${toolName}  ${bar(val, maxVal)}  ${cost.padStart(10)}  ${fmtPct(pct)}`)
          lines.push(`     ${D}${countStr} calls · ${dur}${R}`)
        }
      }

      lines.push('')
      lines.push('━'.repeat(52))
      lines.push('')
      console.log(lines.join('\n'))
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
