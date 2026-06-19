/**
 * daemon.ts — Servidor HTTP + SSE con inteligencia integrada
 *
 * Phase 2 agrega:
 * - Enriquecimiento de coste desde JSONL (enricher)
 * - Análisis de inteligencia (loops + eficiencia) al recibir cada cost update
 * - Endpoint GET /intelligence/:sessionId
 * - Endpoint GET /sessions para el dashboard futuro
 *
 * Phase 3 agrega:
 * - Sirve el dashboard React desde dashboard/dist
 * - Endpoint GET /meta-stats: KPIs de HANDOFF, Engram, config y alertas
 * - Procesa JSONL al conectar nuevo cliente SSE (contexto inmediato)
 */

import crypto from 'crypto'
import express, { type Request, type Response } from 'express'
import path   from 'path'
import fs     from 'fs'
import os     from 'os'
import { dbOps }                                                    from './db'
import { startEnricher, stopEnricher }                                        from './enricher'
import { readConfig, getWarnLevel }                                 from './config'
import { computeQuota }                                              from './quota-tracker'
import { sendDesktopNotification, sendWebhookAlert } from './notifier'
import { eventsRouter, onCostUpdate, onCompactDetected, setSessionStopCallback }            from './routes/events'
import { streamRouter, getSseClientsSize, broadcast }               from './routes/stream'
import { projectsRouter, inferProjectCwd }                          from './routes/projects'
import { historyRouter }                                            from './routes/history'
import { miscRouter }                                               from './routes/misc'
import { reportsRouter, getReportDateLabel, generateReport }        from './routes/reports'
import { topRouter }                                                  from './routes/top'
import { opencodeReaderRouter }                                       from './routes/opencode-reader'
import { replayRouter }                                               from './routes/replay'
import { intentsRouter }                                             from './routes/intents'
import { orchestrationRouter }                                        from './routes/orchestration'
import { getProjectsCached, invalidateProjectsCache }               from './cache/projects-cache'
import { stopRateLimiter }                                            from './middleware/rate-limiter'
import { summarizeSession }                                         from './summarizer'
import { getPidFile, getClaudestatDir, getDashboardDir, portCheckCmd, writePortFile, getPauseSignalFile, getOpencodeDir }            from './paths'
import { logger } from './logger'
import { getAlertState, persistAlertState } from './alert-persist'

const PORT = readConfig().port
const app  = express()
app.use(express.json())

// ─── Shutdown graceful (cross-platform, no depende de SIGTERM) ────────────────

let _server: ReturnType<typeof app.listen> | null = null

app.post('/shutdown', (_req: Request, res: Response) => {
  res.json({ ok: true })
  if (_server) shutdown(_server)
  process.exit(0)
})

// ─── Montar rutas ─────────────────────────────────────────────────────────────

app.use(eventsRouter)
app.use(streamRouter)
app.use(projectsRouter)
app.use(historyRouter)
app.use(miscRouter)
app.use(reportsRouter)
app.use(topRouter)
app.use(opencodeReaderRouter)
app.use(replayRouter)
app.use(intentsRouter)
app.use(orchestrationRouter)

// ─── GET /health — necesita acceso al tamaño del pool SSE ─────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: getSseClientsSize() })
})

// ─── Dashboard React (servir estáticos del build de Vite) ────────────────────

const DASHBOARD_DIST = getDashboardDir()
app.use(express.static(DASHBOARD_DIST, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  },
}))

// SPA fallback: cualquier ruta no capturada sirve index.html
app.get('*', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.sendFile(path.join(DASHBOARD_DIST, 'index.html'))
})

// ─── Migración de arranque: etiquetar sesiones históricas ────────────────────

function migrateSessionProjects() {
  const sessions = dbOps.getAllSessions()
  const HOME = os.homedir()
  let tagged = 0
  for (const session of sessions) {
    if (session?.project_path && session.project_path !== HOME) continue
    const events = dbOps.getSessionEvents(session.id)
    const projectCwd = inferProjectCwd(events)
    if (projectCwd) {
      dbOps.updateSessionProject(session.id, projectCwd)
      tagged++
    }
  }
  if (tagged > 0) logger.info(`${tagged} sessions tagged with project`)
}

/**
 * Genera summaries IA para las últimas N sesiones que no tienen uno.
 * Se ejecuta en background al arrancar el daemon — no bloquea el inicio.
 */
async function migrateSessionSummaries(limit = 5) {
  const sessions = dbOps.getAllSessions()
    .filter(s => !s?.ai_summary)
    .slice(0, limit)

  for (const s of sessions) {
    try {
      const events      = dbOps.getSessionEvents(s.id)
      const projectName = s.project_path ? path.basename(s.project_path) : undefined
      const summary     = await summarizeSession(events, s.total_cost_usd ?? 0, projectName)
      if (summary) {
        dbOps.updateSessionSummary(s.id, summary)
        logger.info(`Summary generated for session ${s.id.slice(0, 8)}: "${summary}"`)
      }
    } catch (err) { logger.error(`Error generating summary: ${err}`) }
  }
}

// ─── Previous hashes map for external change detection ──────────────────────────
let _prevHashes = new Map<string, string>()

// ─── Interval refs for cleanup ────────────────────────────────────────────────

let projectCacheInterval: ReturnType<typeof setInterval> | null = null
let reportInterval:       ReturnType<typeof setInterval> | null = null
let alertInterval:        ReturnType<typeof setInterval> | null = null
let intentCleanupInterval: ReturnType<typeof setInterval> | null = null
let intentWatchInterval: ReturnType<typeof setInterval> | null = null

function shutdown(server: import('http').Server) {
  stopEnricher()
  stopRateLimiter()
  if (projectCacheInterval)   { clearInterval(projectCacheInterval);   projectCacheInterval   = null }
  if (reportInterval)         { clearInterval(reportInterval);         reportInterval         = null }
  if (alertInterval)          { clearInterval(alertInterval);          alertInterval          = null }
  if (intentCleanupInterval)  { clearInterval(intentCleanupInterval);  intentCleanupInterval  = null }
  if (intentWatchInterval)    { clearInterval(intentWatchInterval);    intentWatchInterval    = null }
  _prevHashes.clear()
  cleanPid()
  server.close(() => {})
}

const LEVEL_RANK = { yellow: 1, orange: 2, red: 3 } as const
const LEVEL_COLOR = {
  yellow: '\x1b[33m',
  orange: '\x1b[33m',
  red:    '\x1b[31m',
} as const

let _lastCycleAlertLevel:  string | null = null
let _lastWeeklyAlertLevel: string | null = null
let _resetReminderFired = false
let _weeklyThresholdsFired = new Set<number>()
let _lastWeeklyPctSeen = 0
let _lastCycleResetAt  = 0
let _contextThresholdsFired = new Map<string, Set<number>>()
const CONTEXT_THRESHOLDS = [50, 75, 90]

function checkAlertLevel(
  level: 'yellow' | 'orange' | 'red' | null,
  lastLevel: string | null,
  logMsg: string,
  notifTitle: string,
  notifBody: string
): string | null {
  if (!level) return null
  const prevRank = lastLevel ? LEVEL_RANK[lastLevel as keyof typeof LEVEL_RANK] ?? 0 : 0
  const currRank = LEVEL_RANK[level]
  if (currRank > prevRank) {
    logger.warn(logMsg)
    process.stderr.write(`${LEVEL_COLOR[level]}${logMsg}\x1b[0m\n`)
    sendDesktopNotification(notifTitle, notifBody)
  }
  return currRank > prevRank ? level : lastLevel
}

function startAlertPolling() {
  const as = getAlertState()
  _lastCycleAlertLevel  = as.cycleAlertLevel
  _lastWeeklyAlertLevel = as.weeklyAlertLevel
  _weeklyThresholdsFired = new Set(as.weeklyThresholdsFired)
  _resetReminderFired   = as.resetReminderFired
  _lastWeeklyPctSeen    = as.lastWeeklyPctSeen
  _lastCycleResetAt     = as.lastCycleResetAt
  for (const [sid, ths] of Object.entries(as.contextThresholdsFired)) {
    _contextThresholdsFired.set(sid, new Set(ths))
  }

  function saveState() {
    const s = getAlertState()
    s.cycleAlertLevel        = _lastCycleAlertLevel
    s.weeklyAlertLevel       = _lastWeeklyAlertLevel
    s.weeklyThresholdsFired  = Array.from(_weeklyThresholdsFired)
    s.resetReminderFired     = _resetReminderFired
    s.lastCycleResetAt       = _lastCycleResetAt
    s.lastWeeklyPctSeen      = _lastWeeklyPctSeen
    s.contextThresholdsFired = Object.fromEntries(
      Array.from(_contextThresholdsFired.entries()).map(([k, v]) => [k, Array.from(v)])
    )
    persistAlertState()
  }

  alertInterval = setInterval(() => {
    try {
      const cfg  = readConfig()
      if (!cfg.alertsEnabled) return
      const data = computeQuota(cfg.plan ?? undefined)
      const resetMins = Math.ceil(data.cycleResetMs / 60_000)

      // Detect cycle reset — clear level tracking so new cycle can fire fresh
      if (data.cycleResetAt !== _lastCycleResetAt && _lastCycleResetAt !== 0) {
        _lastCycleAlertLevel = null
      }
      _lastCycleResetAt = data.cycleResetAt

      // ── Cycle 5h alerts ──────────────────────────────────────────────────────
      const cycleLevel = getWarnLevel(data.cyclePct, cfg.warnThresholds)
      if (cycleLevel && cycleLevel !== _lastCycleAlertLevel) {
        const webhookUrl = readConfig().webhookUrl
        if (webhookUrl) {
          sendWebhookAlert(webhookUrl, {
            title: 'claudestat — 5h cycle alert',
            body: `${data.cyclePct}% of cycle used · resets in ${resetMins}m`,
            level: cycleLevel,
            cyclePct: data.cyclePct,
            resetInMins: resetMins,
            burnRate: data.burnRateTokensPerMin,
          })
        }
      }
      const prevCycleLevel = _lastCycleAlertLevel
      _lastCycleAlertLevel = checkAlertLevel(
        cycleLevel,
        _lastCycleAlertLevel,
        `[claudestat] ⚠️  5h cycle at ${data.cyclePct}% (${data.cyclePrompts}/${data.cycleLimit} prompts)`,
        'claudestat — 5h cycle alert',
        `${data.cyclePct}% of cycle used · resets in ${resetMins}m`
      )
      if (_lastCycleAlertLevel !== prevCycleLevel) saveState()

      // ── Weekly alerts ────────────────────────────────────────────────────────
      const weeklyLevel = getWarnLevel(data.weeklyPctAll, cfg.weeklyWarnThresholds)
      if (weeklyLevel && weeklyLevel !== _lastWeeklyAlertLevel) {
        const webhookUrl = readConfig().webhookUrl
        if (webhookUrl) {
          sendWebhookAlert(webhookUrl, {
            title: 'claudestat — Weekly usage alert',
            body: `${data.weeklyPctAll}% of weekly quota used`,
            level: weeklyLevel,
            cyclePct: data.cyclePct,
            weeklyPct: data.weeklyPctAll,
            resetInMins: resetMins,
          })
        }
      }
      const prevWeeklyLevel = _lastWeeklyAlertLevel
      _lastWeeklyAlertLevel = checkAlertLevel(
        weeklyLevel,
        _lastWeeklyAlertLevel,
        `[claudestat] ⚠️  Weekly usage at ${data.weeklyPctAll}%`,
        'claudestat — Weekly usage alert',
        `${data.weeklyPctAll}% of weekly quota used`
      )
      if (_lastWeeklyAlertLevel !== prevWeeklyLevel) saveState()

      // ── Weekly plan threshold alerts (25/50/75/90/100%) ────────────────────────
      const weeklyPct = data.weeklyPctAll
      if (weeklyPct < _lastWeeklyPctSeen) {
        _weeklyThresholdsFired.clear()
        saveState()
      }
      _lastWeeklyPctSeen = weeklyPct
      const WEEKLY_THRESHOLDS = [25, 50, 75, 90, 100] as const
      for (const th of WEEKLY_THRESHOLDS) {
        if (weeklyPct >= th && !_weeklyThresholdsFired.has(th)) {
          _weeklyThresholdsFired.add(th)
          const daysLeft = parseFloat((7 * (100 - weeklyPct) / 100).toFixed(1))
          const weekInsight = dbOps.getWeeklyInsight(7)
          const dailyBurn = weekInsight ? weekInsight.total_cost / 7 : 0
          const planLabel = data.detectedPlan === 'pro' ? 'Pro'
            : data.detectedPlan === 'free' ? 'Free'
            : data.detectedPlan === 'max5' ? 'Max5'
            : data.detectedPlan === 'max20' ? 'Max20'
            : data.detectedPlan
          const burnStr = dailyBurn < 0.005 ? '$0.00' : `$${dailyBurn.toFixed(2)}`
          sendDesktopNotification(
            'claudestat — Weekly plan usage',
            `Plan ${planLabel} · ${weeklyPct}% weekly · ~${daysLeft} days left · burn: ${burnStr}/day`
          )
          saveState()
        }
      }

      // ── Reset reminder ───────────────────────────────────────────────────────
      const reminderMs = (cfg.resetReminderMins ?? 10) * 60_000
      if (reminderMs > 0) {
        if (data.cycleResetMs > reminderMs * 1.5) {
          _resetReminderFired = false  // cycle reset happened — arm reminder again
        } else if (data.cycleResetMs <= reminderMs && data.cycleResetMs > 0 && !_resetReminderFired) {
          const mins = Math.ceil(data.cycleResetMs / 60_000)
          logger.info(`Quota resets in ${mins}m — good time to wrap up`)
          process.stderr.write(`\x1b[36m[claudestat] ⏰  Quota resets in ${mins}m — good time to wrap up\x1b[0m\n`)
          sendDesktopNotification(
            'claudestat — Quota reset soon',
            `Your 5h cycle resets in ${mins} min — good time to start a new task`
          )
          _resetReminderFired = true
          saveState()
        }
      }

      // ── Context percentage alerts ────────────────────────────────────────────
      try {
        const session = dbOps.getLatestClaudeSession()
        if (session && session.context_window && session.context_window > 0 && session.context_used != null) {
          if (!_contextThresholdsFired.has(session.id)) {
            _contextThresholdsFired.set(session.id, new Set())
          }
          const fired = _contextThresholdsFired.get(session.id)!
          const pct = Math.round((session.context_used / session.context_window) * 100)
          if (pct >= 50) {
            for (const th of CONTEXT_THRESHOLDS) {
              if (pct >= th && !fired.has(th)) {
                fired.add(th)
                saveState()
                logger.warn(`[claudestat] Context at ${pct}% (${session.context_used.toLocaleString()} / ${session.context_window.toLocaleString()} tokens) — threshold ${th}%`)
                process.stderr.write(`\x1b[33m[claudestat] ⚠️  Context at ${pct}% — ${session.context_used.toLocaleString()} / ${session.context_window.toLocaleString()} tokens\x1b[0m\n`)
                sendDesktopNotification(
                  'claudestat — Context usage alert',
                  `Context at ${th}% (${pct}%) — ${session.context_used.toLocaleString()} / ${session.context_window.toLocaleString()} tokens`
                )
                broadcast({
                  type: 'context_threshold',
                  payload: {
                    session_id: session.id,
                    pct, threshold: th,
                    context_used: session.context_used,
                    context_window: session.context_window
                  }
                })
              }
            }
          }
        }
      } catch { /* context check non-critical */ }

      // ── Orchestration alerts ──────────────────────────────────────────────
      try {
        const projFile = path.join(getOpencodeDir(), 'projects.json')
        if (fs.existsSync(projFile)) {
          const projects: Record<string, string> = JSON.parse(fs.readFileSync(projFile, 'utf-8')).projects ?? {}
          for (const [name, p] of Object.entries(projects)) {
            const wfPath = path.join(p as string, 'workflow.json')
            if (!fs.existsSync(wfPath)) continue
            try {
              const wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8'))
              if (!wf?.version || wf.version < 2) continue

              if (wf.phase_retry_count >= 3 && wf.phase_status !== 'done') {
                sendDesktopNotification(
                  'Orchestrator — Loop breaker',
                  `${name}: Fase "${wf.current_phase}" con ${wf.phase_retry_count} correcciones consecutivas`
                )
              }
              if (wf.phase_status === 'interrupted') {
                sendDesktopNotification(
                  'Orchestrator — Interrupted',
                  `${name}: Orquestación interrumpida — usa --resume para retomar`
                )
              }
              if (wf.waiting_for_user) {
                broadcast({
                  type: 'orchestration_alert',
                  payload: { project: name, alert: 'waiting_for_user', phase: wf.current_phase }
                })
              }
            } catch {}
          }
        }
      } catch { /* orchestration check non-critical */ }

      // Write or remove pause signal file based on kill switch state
      const signalFile = getPauseSignalFile()
      if (cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold) {
        const msg = `Quota at ${data.cyclePct}% — threshold is ${cfg.killSwitchThreshold}%. Resets in ${Math.ceil(data.cycleResetMs / 60_000)}m.`
        try { fs.writeFileSync(signalFile, msg) } catch {}
        broadcast({ type: 'kill_switch', payload: { blocked: true, reason: msg } })
      } else {
        try { fs.unlinkSync(signalFile) } catch {}
      }
    } catch {
      // quota read failed — ignore
    }
  }, 60_000)
}

// ─── Report scheduler ─────────────────────────────────────────────────────────

const PROJECTS_CACHE_TTL = 2 * 60_000  // 2 minutos

const PID_FILE = getPidFile()

function writePid() {
  try {
    const dir = getClaudestatDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(PID_FILE, String(process.pid))
  } catch {}
}

function cleanPid() {
  try { fs.unlinkSync(PID_FILE) } catch {}
}

export function startDaemon() {
  _server = app.listen(PORT, '127.0.0.1', () => {
    writePid()
    writePortFile(PORT)
    process.on('exit', cleanPid)
    process.on('SIGTERM', () => { if (_server) shutdown(_server); process.exit(0) })
    process.on('SIGINT',  () => { if (_server) shutdown(_server); process.exit(0) })

    console.log(`\n● claudestat daemon  →  http://localhost:${PORT}`)
    console.log(`  Watching for events...\n`)
    console.log(`  In another terminal: \x1b[36mclaudestat watch\x1b[0m\n`)

    // Weekly insight — se muestra una vez por semana al iniciar el daemon
    import('./insights').then(({ getWeeklyInsightData, shouldShowInsight, markInsightShown, renderWeeklyInsight }) => {
      try {
        if (!shouldShowInsight()) return
        const data = getWeeklyInsightData()
        if (data.total_sessions >= 3) {
          console.log(renderWeeklyInsight(data))
        }
        markInsightShown()
      } catch { /* insight is non-critical */ }
    })

    // Etiquetar sesiones históricas que no tienen proyecto asignado
    migrateSessionProjects()

    // Pre-scan de proyectos al arrancar — garantiza respuesta inmediata en el tab
    // Se ejecuta en background para no retrasar el inicio del servidor
    setImmediate(() => {
      const projects = getProjectsCached()
      logger.info(`${projects?.length ?? 0} projects scanned`)
    })

    // Refresh automático del cache de proyectos cada 2 minutos
    // Recoge cambios en HANDOFF.md aunque el daemon lleve horas corriendo
    projectCacheInterval = setInterval(() => {
      invalidateProjectsCache()
      getProjectsCached()
    }, PROJECTS_CACHE_TTL)

    // Iniciar el watcher de JSONL para enriquecimiento de coste
    startEnricher(onCostUpdate, onCompactDetected)

    setSessionStopCallback((sessionId: string) => {
      try {
        const cfg = readConfig()
        if (!cfg.alertsEnabled) return
        const s = dbOps.getSession(sessionId)
        if (!s) return
        const cost = s.total_cost_usd ?? 0
        const totalTok = (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0)
        const eff = s.efficiency_score ?? 100
        const loops = s.loops_detected ?? 0
        const costStr = cost < 0.005 ? '< $0.01' : `$${cost.toFixed(2)}`
        const tokStr = totalTok >= 1_000_000
          ? `${(totalTok / 1_000_000).toFixed(1)}M`
          : totalTok >= 1_000 ? `${Math.round(totalTok / 1_000)}K` : `${totalTok}`
        let body = `Session closed · ${costStr} · ${tokStr} tokens · efficiency ${eff}%`
        if (loops >= 5) body += ` · ${loops} loops — add context to CLAUDE.md`
        sendDesktopNotification('claudestat — Session closed', body)
      } catch {}
    })

    // Scheduler de informes automáticos — corre cada minuto
    reportInterval = setInterval(() => {
      const cfg = readConfig()
      if (!cfg.reportsEnabled) return
      const dateLabel = getReportDateLabel(new Date(), cfg)
      if (!dateLabel) return
      if (dbOps.getWeeklyReportByDate(dateLabel)) return   // ya existe
      const markdown = generateReport(dateLabel, cfg)
      dbOps.insertWeeklyReport(dateLabel, markdown)
      logger.info(`Report auto-generated: ${dateLabel}`)
    }, 60_000)

    // Al arrancar: liberar intents activos de sesiones anteriores (ya no hay nadie que los use)
    dbOps.releaseOrphanedIntents()

    // Cleanup de intents — cada 2min marca stale los sin heartbeat > 10min, borra viejos > 1h
    intentCleanupInterval = setInterval(() => {
      dbOps.markStaleIntents()
      dbOps.deleteOldStaleIntents()
    }, 2 * 60_000)

    // Watcher de cambios externos — cada 10s compara hashes de archivos en intents activos
    intentWatchInterval = setInterval(() => {
      const active = dbOps.getActiveIntents()
      if (active.length === 0) return
      const fileSet = new Set(active.map(a => a.file_path))
      for (const filePath of fileSet) {
        try {
          if (!fs.existsSync(filePath)) continue
          const content = fs.readFileSync(filePath)
          const hash = crypto.createHash('sha256').update(content).digest('hex')
          const prev = _prevHashes.get(filePath)
          if (prev && prev !== hash) {
            // Check if any active intent covers this file
            const coveringIntent = active.find(a => a.file_path === filePath)
            const tool = coveringIntent?.tool ?? 'unknown'
            broadcast({ type: 'external_change', payload: { file: filePath, tool, hash_prev: prev, hash_now: hash } })
          }
          _prevHashes.set(filePath, hash)
        } catch {}
      }
      // Cleanup stale entries from prevHashes
      for (const [fp] of _prevHashes) {
        if (!fileSet.has(fp)) _prevHashes.delete(fp)
      }
    }, 10_000)

    // Summaries IA solo si opt-in explícito (CLAUDESTAT_AI_SUMMARY=true)
    if (process.env.CLAUDESTAT_AI_SUMMARY === 'true') {
      migrateSessionSummaries(5).catch(() => {})
    }

    // Polling de alertas de rate limit cada 60s
    startAlertPolling()

    // API quota data is refreshed on-demand by the CLI status command (disk cache shared)
  })

  // Manejo de error de puerto ocupado — fuera del callback para capturar EADDRINUSE
  _server!.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: Port ${PORT} is already in use.`)
      console.error(`   Is claudestat already running? Check with: ${portCheckCmd(PORT)}`)
      console.error(`   If so, you don't need to start it again.\n`)
      process.exit(1)
    }
    throw err
  })
}
