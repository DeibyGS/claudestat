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

import express, { type Request, type Response } from 'express'
import path   from 'path'
import fs     from 'fs'
import { dbOps }                                                    from './db'
import { startEnricher, stopEnricher, cleanupSession }                        from './enricher'
import { readConfig }                                               from './config'
import { eventsRouter, onCostUpdate, onCompactDetected }            from './routes/events'
import { streamRouter, getSseClientsSize }                          from './routes/stream'
import { projectsRouter, inferProjectCwd }                          from './routes/projects'
import { historyRouter }                                            from './routes/history'
import { miscRouter }                                               from './routes/misc'
import { reportsRouter, getReportDateLabel, generateReport }        from './routes/reports'
import { topRouter }                                                  from './routes/top'
import { getProjectsCached, invalidateProjectsCache }               from './cache/projects-cache'
import { stopRateLimiter }                                            from './middleware/rate-limiter'
import { startWatchdog }                                              from './watchdog'
import { summarizeSession }                                         from './summarizer'
import { getPidFile, getClaudestatDir, portCheckCmd }              from './paths'

const PORT = 7337
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

// ─── GET /health — necesita acceso al tamaño del pool SSE ─────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: getSseClientsSize() })
})

// ─── Dashboard React (servir estáticos del build de Vite) ────────────────────

const DASHBOARD_DIST = path.join(__dirname, '..', 'dashboard', 'dist')
app.use(express.static(DASHBOARD_DIST))

// SPA fallback: cualquier ruta no capturada sirve index.html
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(DASHBOARD_DIST, 'index.html'))
})

// ─── Migración de arranque: etiquetar sesiones históricas ────────────────────

function migrateSessionProjects() {
  const sessions = dbOps.getAllSessions()
  let tagged = 0
  for (const session of sessions) {
    if ((session as any).project_path) continue
    const events = dbOps.getSessionEvents(session.id)
    const projectCwd = inferProjectCwd(events)
    if (projectCwd) {
      dbOps.updateSessionProject(session.id, projectCwd)
      tagged++
    }
  }
    if (tagged > 0) console.log(`[daemon] ${tagged} sessions tagged with project`)
}

/**
 * Genera summaries IA para las últimas N sesiones que no tienen uno.
 * Se ejecuta en background al arrancar el daemon — no bloquea el inicio.
 */
async function migrateSessionSummaries(limit = 5) {
  const sessions = dbOps.getAllSessions()
    .filter(s => !(s as any).ai_summary)
    .slice(0, limit)

  for (const s of sessions) {
    try {
      const events      = dbOps.getSessionEvents(s.id)
      const projectName = s.project_path ? path.basename(s.project_path) : undefined
      const summary     = await summarizeSession(events, s.total_cost_usd ?? 0, projectName)
      if (summary) {
        dbOps.updateSessionSummary(s.id, summary)
        console.log(`[daemon] Summary generado para sesión ${s.id.slice(0, 8)}: "${summary}"`)
      }
    } catch (err) { console.error('[daemon] Error generating summary:', err) }
  }
}

// ─── Interval refs for cleanup ────────────────────────────────────────────────

let projectCacheInterval: ReturnType<typeof setInterval> | null = null
let reportInterval: ReturnType<typeof setInterval> | null = null

function shutdown(server: import('http').Server) {
  stopEnricher()
  stopRateLimiter()
  if (projectCacheInterval) { clearInterval(projectCacheInterval); projectCacheInterval = null }
  if (reportInterval) { clearInterval(reportInterval); reportInterval = null }
  cleanPid()
  server.close()
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
    process.on('exit', cleanPid)
    process.on('SIGTERM', () => { shutdown(_server!); process.exit(0) })
    process.on('SIGINT',  () => { shutdown(_server!); process.exit(0) })

    console.log(`\n● claudestat daemon  →  http://localhost:${PORT}`)
    console.log(`  Waiting for Claude Code events...\n`)
    console.log(`  In another terminal: \x1b[36mclaudestat watch\x1b[0m\n`)

    // Etiquetar sesiones históricas que no tienen proyecto asignado
    migrateSessionProjects()

    // Pre-scan de proyectos al arrancar — garantiza respuesta inmediata en el tab
    // Se ejecuta en background para no retrasar el inicio del servidor
    setImmediate(() => {
      const projects = getProjectsCached()
      console.log(`[daemon] ${projects?.length ?? 0} projects scanned`)
    })

    // Refresh automático del cache de proyectos cada 2 minutos
    // Recoge cambios en HANDOFF.md aunque el daemon lleve horas corriendo
    projectCacheInterval = setInterval(() => {
      invalidateProjectsCache()
      getProjectsCached()
    }, PROJECTS_CACHE_TTL)

    // Iniciar el watcher de JSONL para enriquecimiento de coste
    startEnricher(onCostUpdate, onCompactDetected)

    // Scheduler de informes automáticos — corre cada minuto
    reportInterval = setInterval(() => {
      const cfg = readConfig()
      if (!cfg.reportsEnabled) return
      const dateLabel = getReportDateLabel(new Date(), cfg)
      if (!dateLabel) return
      if (dbOps.getWeeklyReportByDate(dateLabel)) return   // ya existe
      const markdown = generateReport(dateLabel, cfg)
      dbOps.insertWeeklyReport(dateLabel, markdown)
      console.log(`[daemon] Report auto-generated: ${dateLabel}`)
    }, 60_000)

    // Summaries IA solo si opt-in explícito (CLAUDESTAT_AI_SUMMARY=true)
    if (process.env.CLAUDESTAT_AI_SUMMARY === 'true') {
      migrateSessionSummaries(5).catch(() => {})
    }
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
