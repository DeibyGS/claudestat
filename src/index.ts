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
import { startWatch }                   from './watch'
import { runInstall, runWizard, uninstallHooks } from './install'
import { uninstallService } from './service'
import { runExport } from './export'
import { readConfig, writeConfig }      from './config'
import type { ClaudestatConfig }        from './config'
import { runDoctor }                    from './doctor'
import { runRoast }                  from './roast'
import { computeProjection, formatProjection } from './cost-projector'
import { getWeeklyInsightData, renderWeeklyInsight, getUsageInsights, renderInsights, getPrevWeekInsightData } from './insights'
import { getPidFile, isWindows, getClaudestatDir, getPauseSignalFile, getDaemonLogFile } from './paths'
import { refreshFromApi } from './quota-tracker'

const program  = new Command()
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version
const PID_FILE = getPidFile()
const PORT = readConfig().port

function semverGt(a: string, b: string): boolean {
  const [pa, pb] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < 3; i++) {
    const aVal = pa[i] ?? 0, bVal = pb[i] ?? 0
    if (aVal > bVal) return true
    if (aVal < bVal) return false
  }
  return false
}

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
    if ((code ?? 0) === 0 && cachedLatest && semverGt(cachedLatest, PKG_VERSION)) {
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
  console.log(`   Dashboard → http://localhost:${PORT}`)
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE) } catch {}
}

async function stopDaemon(): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${PORT}/shutdown`, {
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
  .command('update')
  .description('Check for updates and install the latest version from npm')
  .option('--dry-run', 'Only check for updates, do not install')
  .action(async (opts) => {
    console.log('\n🔍 Checking for updates...')

    const latest = await checkLatestVersion()
    if (!latest) {
      console.log('  ❌ Could not reach npm registry. Check your internet connection.\n')
      process.exit(1)
    }

    if (!semverGt(latest, PKG_VERSION)) {
      console.log(`  ✅ Already on latest version (${PKG_VERSION})\n`)
      process.exit(0)
    }

    console.log(`  ✦ Update available: ${PKG_VERSION} → ${latest}`)

    try {
      const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')
      const changelog     = fs.readFileSync(changelogPath, 'utf8')
      const sections      = changelog.split(/^## /m).filter(Boolean)
      const relevant      = sections.filter(s =>
        s.startsWith(`[${latest}]`) ||
        (semverGt(s.split(']')[0].replace('[', ''), PKG_VERSION) &&
         semverGt(latest, s.split(']')[0].replace('[', '')))
      )
      if (relevant.length > 0) {
        console.log('\n  📋 What\'s new:')
        relevant.slice(0, 3).forEach(s => {
          const lines = s.split('\n').slice(0, 6)
          lines.forEach(l => console.log(`  ${l}`))
        })
      }
    } catch {}

    if (opts.dryRun) {
      console.log(`\n  Run \x1b[36mclaudestat update\x1b[0m to install.\n`)
      process.exit(0)
    }

    console.log(`\n📦 Installing @statforge/claudestat@${latest}...`)
    try {
      execSync('npm install -g @statforge/claudestat', { stdio: 'inherit' })
    } catch {
      console.error('\n❌ Installation failed. Try manually: npm install -g @statforge/claudestat\n')
      process.exit(1)
    }

    console.log('\n🔗 Re-registering hooks...')
    try {
      const { installHooks } = await import('./install')
      installHooks()
    } catch {}

    console.log('\n🔄 Restarting daemon...')
    try {
      await stopDaemon().catch(() => {})
      await new Promise(r => setTimeout(r, 500))
      spawnDaemon()
    } catch {}

    console.log(`\n✅ Updated to ${latest}. Run \x1b[36mclaudestat doctor\x1b[0m to verify.\n`)
    process.exit(0)
  })

program
  .command('start')
  .description('Start the background daemon (receives Claude Code hook events)')
  .option('--watchdog', 'Auto-restart daemon if it crashes')
  .option('--wait',    'Wait until daemon responds on /health before returning (max 10s)')
  .action(async (opts) => {
    if (process.env.CLAUDESTAT_DAEMON) {
      const { startDaemon }   = require('./daemon')  as { startDaemon: () => void }
      startDaemon()
      if (opts.watchdog) {
        const { startWatchdog } = require('./watchdog') as { startWatchdog: () => void }
        startWatchdog()
      }
    } else {
      spawnDaemon()
      if (opts.wait) {
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 200))
          try {
            const res = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(500) })
            if (res.ok) {
              console.log('✅ Daemon is ready')
              break
            }
          } catch {}
        }
      }
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
  .option('--port <number>', 'Custom daemon port (default: 7337)')
  .option('--reset', 'Reinstall from scratch (keeps SQLite history)')
  .action(async (opts) => {
    if (opts.port) {
      const p = parseInt(opts.port, 10)
      if (!isNaN(p) && p >= 1024 && p <= 65535) {
        const cfg = readConfig()
        writeConfig({ ...cfg, port: p })
        console.log(`✓ Port set to ${p}`)
      } else {
        console.error('❌ Invalid port. Must be between 1024 and 65535.')
        process.exit(1)
      }
    }

    if (opts.uninstall) {
      console.log('Uninstalling claudestat...')
      uninstallService()
      uninstallHooks()
      await stopDaemon().catch(() => {})
      console.log('✅ claudestat fully removed')
      process.exit(0)
    }

    if (opts.reset) {
      console.log('\n🔄 Resetting claudestat installation...')
      uninstallService()
      uninstallHooks()
      await stopDaemon().catch(() => {})
      const cfgPath = path.join(getClaudestatDir(), 'config.json')
      try { fs.unlinkSync(cfgPath) } catch {}
      console.log('  ✅ Hooks, service, and config removed (history preserved)')
      console.log('  🔁 Starting fresh install...\n')
    }

    // 1. Wizard: Node check + plan + config + hooks + MCP
    await runWizard()

    // 2. Start daemon now
    const daemonRunning = await fetch(`http://localhost:${PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    }).then(r => r.ok).catch(() => false)

    if (!daemonRunning) {
      spawnDaemon()
    } else {
      console.log('✅ Daemon already running')
      console.log(`   Dashboard → http://localhost:${PORT}`)
    }

    console.log('\n   Run \x1b[36mclaudestat watch\x1b[0m to see live activity')
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
  .description('Export session data (json | csv | markdown, default: json). Max 500 sessions.')
  .option('--from <date>',    'Start date YYYY-MM-DD (inclusive)')
  .option('--to <date>',      'End date YYYY-MM-DD (inclusive)')
  .option('--since <period>', 'Shorthand: 7d, 30d, 90d (overrides --from)')
  .option('--project <name>', 'Filter by project path (case-insensitive substring)')
  .option('--output <path>',  'Write to file (default: stdout)')
  .action((format: string | undefined, opts) => {
    const fmt = (format ?? 'json').toLowerCase()
    if (!['json', 'csv', 'markdown'].includes(fmt)) {
      console.error('Error: format must be "json", "csv", or "markdown"')
      process.exit(1)
    }
    runExport({ format: fmt as 'json' | 'csv' | 'markdown', ...opts })
    process.exit(0)
  })

program
  .command('status')
  .description('Show current quota, cost and burn rate')
  .option('--json', 'Output raw JSON instead of formatted text')
  .action(async (opts) => {
    try {
      await refreshFromApi()  // refresh disk cache on demand; daemon reads from disk
      const [quotaRes] = await Promise.all([
        fetch(`http://localhost:${PORT}/quota`),
        fetch(`http://localhost:${PORT}/health`),
      ])
      if (!quotaRes.ok) throw new Error('Daemon unavailable')

      const q = await quotaRes.json() as any

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
  .option('--kill-switch <bool>',   'Enable/disable kill switch: true|false')
  .option('--threshold <number>',   'Quota percentage to trigger the kill switch (default: 95)')
  .option('--plan <plan>',          'Force plan detection: pro|max5|max20|auto')
  .option('--alerts <bool>',        'Enable/disable daemon rate limit alerts: true|false')
  .option('--session-limit <usd>',  'Alert when a session exceeds this cost in USD (0 = disabled)')
  .option('--kill-switch-force <bool>', 'Hard-block on kill switch instead of warning: true|false')
  .option('--log-level <level>',        'Set log level: debug|info|warn|error (default: info)')
  .option('--loop-threshold <number>',  'Tool calls in window to trigger loop detection (default: 8)')
  .option('--loop-window <seconds>',    'Detection window in seconds (default: 120)')
  .option('--alias <path=name>',        'Set a project alias: --alias "/path/to/repo=MyApp"')
  .option('--remove-alias <path>',      'Remove a project alias')
  .option('--webhook <url>',            'Set webhook URL for external alerts (Slack, Discord). Use "off" to disable.')
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
    if (opts.sessionLimit !== undefined) {
      const v = parseFloat(opts.sessionLimit)
      if (!isNaN(v) && v >= 0) { cfg.sessionCostLimitUsd = v; changed = true }
      else console.warn('  ⚠️  session-limit must be a number >= 0 (e.g. 5 for $5)')
    }
    if (opts.killSwitchForce !== undefined) {
      cfg.killSwitchForce = opts.killSwitchForce === 'true'
      changed = true
    }
    if (opts.logLevel !== undefined) {
      if (['debug', 'info', 'warn', 'error'].includes(opts.logLevel)) {
        cfg.logLevel = opts.logLevel as ClaudestatConfig['logLevel']
        changed = true
      } else {
      console.warn('  ⚠️  log-level must be: debug | info | warn | error')
    }
    if (opts.loopThreshold !== undefined) {
      const v = parseInt(opts.loopThreshold, 10)
      if (!isNaN(v) && v >= 2 && v <= 50) { cfg.loopThreshold = v; changed = true }
      else console.warn('  ⚠️  loopThreshold must be between 2 and 50')
    }
    if (opts.loopWindow !== undefined) {
      const v = parseInt(opts.loopWindow, 10)
      if (!isNaN(v) && v >= 10 && v <= 600) { cfg.loopWindowSecs = v; changed = true }
      else console.warn('  ⚠️  loopWindow must be between 10 and 600 seconds')
    }
    if (opts.alias !== undefined) {
      const eqIdx = (opts.alias as string).indexOf('=')
      if (eqIdx < 1) {
        console.warn('  ⚠️  format: --alias "/absolute/path=Alias Name"')
      } else {
        const projectPath = (opts.alias as string).slice(0, eqIdx).trim()
        const aliasName   = (opts.alias as string).slice(eqIdx + 1).trim()
        if (!projectPath.startsWith('/') && !projectPath.match(/^[A-Z]:\\/)) {
          console.warn('  ⚠️  project path must be absolute')
        } else {
          cfg.projectAliases = { ...cfg.projectAliases, [projectPath]: aliasName }
          changed = true
        }
      }
    }
    if (opts.removeAlias !== undefined) {
      const { [opts.removeAlias]: _, ...rest } = cfg.projectAliases
      cfg.projectAliases = rest
      changed = true
    }
    if (opts.webhook !== undefined) {
      cfg.webhookUrl = opts.webhook === 'off' ? null : opts.webhook
      changed = true
    }
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
    lines.push(`  Port              ${C}${cfg.port}${R}`)
    lines.push(`  Alerts            ${alertsIcon}`)
    lines.push('')
    lines.push(`  Kill switch       ${cfg.killSwitchEnabled ? `${Y}ON${R} at ${cfg.killSwitchThreshold}%` : `${D}OFF${R}`}`)
    if (cfg.killSwitchEnabled) {
      lines.push(`                    ${bar(cfg.killSwitchThreshold)}`)
    }
    lines.push(`  Session limit     ${cfg.sessionCostLimitUsd > 0 ? `${Y}$${cfg.sessionCostLimitUsd.toFixed(2)}${R}` : `${D}OFF${R}`}`)
    lines.push(`  Kill switch mode  ${cfg.killSwitchForce ? `${R}force-block${R}` : `${G}warn-only${R}  ${D}(use --kill-switch-force true to hard-block)${R}`}`)
    const logColors: Record<string, string> = { debug: D, info: '', warn: Y, error: '\x1b[31m' }
    lines.push(`  Log level         ${logColors[cfg.logLevel] ?? ''}${cfg.logLevel.toUpperCase()}${R}`)
    lines.push(`  Loop detection    ${C}${cfg.loopThreshold} calls${R} in ${C}${cfg.loopWindowSecs}s${R}`)
    lines.push(`  Webhook           ${cfg.webhookUrl ? `${C}${cfg.webhookUrl}${R}` : `${D}off${R}`}`)
    if (Object.keys(cfg.projectAliases).length > 0) {
      lines.push(`  Project aliases`)
      for (const [p, a] of Object.entries(cfg.projectAliases)) {
        lines.push(`    ${D}${p}${R} → ${C}${a}${R}`)
      }
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
  .command('resume')
  .description('Remove the pause signal — allows Claude Code to continue after a quota warning')
  .action(() => {
    const signalFile = getPauseSignalFile()
    try {
      fs.unlinkSync(signalFile)
      console.log('✅ Pause signal removed — claudestat will no longer warn on tool calls')
    } catch {
      console.log('  No pause signal active.')
    }
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
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const by    = opts.by ?? 'cost'
      const limit = opts.limit ?? 10
      const days  = opts.days ?? 30
      const url   = `http://localhost:${PORT}/api/top?by=${by}&limit=${limit}&days=${days}`
      const res   = await fetch(url)
      if (!res.ok) throw new Error('Daemon unavailable')
      const data  = await res.json() as any

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
        process.exit(0)
      }

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
          const avgPerCall = t.count > 0 && !isOther
            ? `$${(t.estimatedCostUsd / t.count).toFixed(4)}`
            : '—'
        const toolName = (t.tool.length > 18 ? t.tool.slice(0, 16) + '…' : t.tool).padEnd(18)

        if (isOther) {
          lines.push(`  ${D}Other${R}  ${'—'.padStart(20)}  ${cost.padStart(10)}  ${fmtPct(pct)}`)
        } else {
          lines.push(`  ${B}${(i + 1).toString().padStart(2)}${R}  ${toolName}  ${bar(val, maxVal)}  ${cost.padStart(10)}  ${fmtPct(pct)}`)
          lines.push(`     ${D}${countStr} calls · ${dur} · avg/call ${avgPerCall}${R}`)
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
  .command('loops')
  .description('List sessions with detected loops')
  .option('--days <number>', 'Look back N days (default: 30)', '30')
  .option('--limit <number>', 'Max sessions to show (default: 10)', '10')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const days  = Math.min(parseInt(opts.days, 10) || 30, 365)
      const limit = Math.min(parseInt(opts.limit, 10) || 10, 50)

      const since = Date.now() - days * 86_400_000
      const res   = await fetch(`http://localhost:${PORT}/sessions`)
      if (!res.ok) throw new Error('Daemon unavailable')

      const sessions: any[] = await res.json()
      const withLoops = sessions
        .filter(s => (s.loops_detected ?? 0) > 0 && s.started_at >= since)
        .slice(0, limit)

      if (opts.json) {
        console.log(JSON.stringify(withLoops, null, 2))
        process.exit(0)
      }

      const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m', Y = '\x1b[33m'

      if (withLoops.length === 0) {
        console.log(`\n  No loops detected in the last ${days} days.\n`)
        process.exit(0)
      }

      console.log(`\n${B}🔁 claudestat loops${R}  ${D}last ${days} days${R}`)
      console.log('━'.repeat(52))

      for (const s of withLoops) {
        const date    = new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        const project = s.project_path ? path.basename(s.project_path) : 'unknown'
        const cost    = s.total_cost_usd ? `$${s.total_cost_usd.toFixed(3)}` : '$0.000'

        console.log(`\n  ${Y}${s.loops_detected} loop(s)${R}  ${B}${project}${R}  ${D}${date}  ${cost}${R}`)

        try {
          const iRes  = await fetch(`http://localhost:${PORT}/intelligence/${s.id}`)
          const intel = await iRes.json() as any
          for (const loop of (intel.loops ?? []).slice(0, 3)) {
            console.log(`    ${D}↳ ${loop.toolName} ×${loop.count} in ${loop.windowMs / 1000}s${R}`)
            if (loop.context?.repeatedFiles?.length > 0) {
              loop.context.repeatedFiles.slice(0, 3).forEach((f: string) =>
                console.log(`      ${D}file: ${path.basename(f)}${R}`)
              )
            }
            if (loop.context?.repeatedCommands?.length > 0) {
              loop.context.repeatedCommands.slice(0, 2).forEach((c: string) =>
                console.log(`      ${D}cmd:  ${c.slice(0, 60)}${R}`)
              )
            }
          }
        } catch {}
      }

      console.log('\n' + '━'.repeat(52) + '\n')
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
  .command('logs')
  .description('Show daemon log (~/.claudestat/daemon.log)')
  .option('-n <number>', 'Number of lines to show (default: 50)', '50')
  .option('--follow', 'Tail the log in real time')
  .option('--level <level>', 'Filter by minimum level: debug|info|warn|error')
  .action((opts) => {
    const logFile = getDaemonLogFile()

    if (!fs.existsSync(logFile)) {
      console.log('\n  No daemon log found. Start the daemon first: claudestat start\n')
      process.exit(0)
    }

    const minRank: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }
    const levelFilter = opts.level ? (minRank[opts.level] ?? 0) : 0

    function filterLine(line: string): boolean {
      if (!opts.level) return true
      const match = line.match(/\[(DEBUG|INFO|WARN|ERROR)\]/)
      if (!match) return true
      return (minRank[match[1].toLowerCase()] ?? 0) >= levelFilter
    }

    const levelColor: Record<string, string> = {
      DEBUG: '\x1b[2m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m'
    }

    function colorize(line: string): string {
      return line.replace(/\[(DEBUG|INFO|WARN|ERROR)\]/, (_, l) =>
        `${levelColor[l] ?? ''}[${l}]\x1b[0m`
      )
    }

    if (opts.follow) {
      const content = fs.readFileSync(logFile, 'utf8')
      content.split('\n').filter(Boolean).filter(filterLine).slice(-20)
        .forEach(l => console.log(colorize(l)))

      let size = fs.statSync(logFile).size
      setInterval(() => {
        try {
          const newSize = fs.statSync(logFile).size
          if (newSize <= size) return
          const buf = Buffer.alloc(newSize - size)
          const fd  = fs.openSync(logFile, 'r')
          fs.readSync(fd, buf, 0, buf.length, size)
          fs.closeSync(fd)
          size = newSize
          buf.toString('utf8').split('\n').filter(Boolean).filter(filterLine)
            .forEach(l => console.log(colorize(l)))
        } catch {}
      }, 300)
    } else {
      const n       = Math.min(parseInt(opts.n, 10) || 50, 500)
      const content = fs.readFileSync(logFile, 'utf8')
      const lines   = content.split('\n').filter(Boolean).filter(filterLine).slice(-n)
      if (lines.length === 0) {
        console.log(`\n  No log entries${opts.level ? ` at level ≥ ${opts.level}` : ''}.\n`)
      } else {
        console.log('')
        lines.forEach(l => console.log(colorize(l)))
        console.log('')
      }
      process.exit(0)
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

      const prev     = getPrevWeekInsightData()
      const deltaCost = prev.total_cost > 0
        ? Math.round((data.total_cost - prev.total_cost) / prev.total_cost * 100)
        : null
      const deltaSessions = prev.total_sessions > 0
        ? Math.round((data.total_sessions - prev.total_sessions) / prev.total_sessions * 100)
        : null

      if (opts.json) {
        console.log(JSON.stringify({ current: data, prev, deltaCostPct: deltaCost, deltaSessionsPct: deltaSessions }, null, 2))
        process.exit(0)
      }
      console.log(renderWeeklyInsight(data))

      if (deltaCost !== null || deltaSessions !== null) {
        const R = '\x1b[0m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m'
        const sign  = (n: number) => n >= 0 ? `+${n}` : `${n}`
        const color = (n: number) => n > 0 ? Y : G
        console.log(`  ${D}vs last week:${R}`)
        if (deltaCost !== null)
          console.log(`    cost      ${color(deltaCost)}${sign(deltaCost)}%${R}`)
        if (deltaSessions !== null)
          console.log(`    sessions  ${sign(deltaSessions)}%`)
        console.log('')
      }

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

program
  .command('project')
  .description('Show cost projection with linear regression')
  .option('--days <number>', 'Look back N days for data (default 90)')
  .option('--json', 'Output raw JSON')
  .action((opts) => {
    try {
      const days = Math.max(7, Math.min(365, parseInt(opts.days ?? '90', 10) || 90))
      const p = computeProjection(days)
      if (opts.json) {
        console.log(JSON.stringify(p, null, 2))
        process.exit(0)
      }
      console.log(formatProjection(p))
      process.exit(0)
    } catch (err: any) {
      console.error('\n❌ Error:', err.message)
      process.exit(1)
    }
  })

program.parse()
