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
import os     from 'os'
import { dbOps, type EventRow }                               from './db'
import { startEnricher, processLatestForSession,
         type CostUpdateCallback,
         type CompactDetectedCallback }                       from './enricher'
import { analyzeSession }                                     from './intelligence'
import { computeMetaStats, getMetaHistory }                   from './meta-stats'
import { discoverProjects, parseHandoffProgress }             from './project-scanner'
import { deriveSessionState, STATE_META }                     from './session-state'
import { computeQuota, invalidateQuotaCache }                 from './quota-tracker'
import { readConfig, getWarnLevel }                           from './config'
import { getGitInfo, type GitInfo }                           from './git'
import { getPRStatus, type PRStatus }                         from './github'
import { summarizeSession }                                   from './summarizer'

const PORT = 7337
const app  = express()
app.use(express.json())

// Clientes SSE conectados — uno por cada `claudetrace watch` abierto
const sseClients = new Map<string, Response>()

// Estado de sesión en memoria — se deriva a demanda, no se persiste en DB.
// Clave: session_id  Valor: {type, ts} del último evento recibido vía /event
const sessionLastEvent = new Map<string, { type: string; ts: number }>()

// ─── Cache de proyectos ───────────────────────────────────────────────────────
// Pre-computado al arrancar el daemon y refrescado cada 2 minutos en background.
// Esto garantiza que la primera apertura del tab Proyectos sea instantánea
// y que los cambios de HANDOFF.md se reflejen sin reiniciar.

let _projectsCache: ReturnType<typeof discoverProjects> | null = null
let _projectsCacheTs = 0
const PROJECTS_CACHE_TTL = 2 * 60_000  // 2 minutos

function getProjectsCached(): ReturnType<typeof discoverProjects> {
  if (_projectsCache && Date.now() - _projectsCacheTs < PROJECTS_CACHE_TTL) {
    return _projectsCache
  }
  _projectsCache = discoverProjects()
  _projectsCacheTs = Date.now()
  return _projectsCache
}

function invalidateProjectsCache() {
  _projectsCache = null
}

// Caché de git info por project path — TTL 30s
const gitCache = new Map<string, { data: GitInfo | null; ts: number }>()
// Caché de PR status por project path — TTL 5min (llamada de red)
const prCache  = new Map<string, { data: PRStatus | null; ts: number }>()

const GIT_TTL = 30_000
const PR_TTL  = 5 * 60_000

function getCachedGitInfo(projectPath: string): GitInfo | null {
  const cached = gitCache.get(projectPath)
  if (cached && Date.now() - cached.ts < GIT_TTL) return cached.data
  const data = getGitInfo(projectPath)
  gitCache.set(projectPath, { data, ts: Date.now() })
  return data
}

function getCachedPRStatus(projectPath: string): PRStatus | null {
  const cached = prCache.get(projectPath)
  if (cached && Date.now() - cached.ts < PR_TTL) return cached.data
  const data = getPRStatus(projectPath)
  prCache.set(projectPath, { data, ts: Date.now() })
  return data
}

function broadcast(msg: object) {
  const data = `data: ${JSON.stringify(msg)}\n\n`
  sseClients.forEach(client => client.write(data))
}

// ─── POST /event — recibe eventos de los hooks de Claude Code ─────────────────

app.post('/event', (req: Request, res: Response) => {
  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Faltan session_id o type' })
    return
  }

  const resolvedCwd = cwd
    ?? (transcript_path ? transcript_path.split('/').slice(0, -1).join('/') : undefined)

  dbOps.upsertSession({ id: session_id, cwd: resolvedCwd, started_at: ts, last_event_at: ts })

  if (type === 'PostToolUse' && tool_name) {
    const pairedId = dbOps.pairPostWithPre(
      session_id, tool_name,
      typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? ''),
      ts
    )
    broadcast({ type: 'event', payload: { type: 'Done', session_id, tool_name, tool_input, ts, pairedId } })
  } else {
    dbOps.insertEvent({
      session_id, type,
      tool_name: tool_name ?? undefined,
      tool_input: tool_input ? JSON.stringify(tool_input) : undefined,
      ts, cwd: resolvedCwd
    })
    broadcast({ type: 'event', payload: req.body })
  }

  // Intentar etiquetar la sesión con su proyecto (solo en eventos de herramientas de archivo)
  const FILE_TOOLS = new Set(['Read','Write','Edit','Glob','Grep'])
  if (FILE_TOOLS.has(tool_name || '') && tool_input) {
    try {
      const inp      = typeof tool_input === 'string' ? JSON.parse(tool_input) : tool_input
      const filePath = (inp.file_path || inp.path) as string | undefined
      if (filePath?.startsWith('/')) {
        const projectCwd = findProjectCwdForFile(filePath)
        if (projectCwd) dbOps.updateSessionProject(session_id, projectCwd)
      }
    } catch { /* ignorar errores de parsing */ }
  }

  // Actualizar estado de sesión en memoria + broadcast state_change via SSE
  sessionLastEvent.set(session_id, { type, ts })
  const state     = deriveSessionState(type, ts)
  const stateMeta = STATE_META[state]
  broadcast({ type: 'state_change', payload: { session_id, state, ...stateMeta } })

  // Al terminar un turno (Stop) → invalidar quota cache + emitir warnings
  if (type === 'Stop') {
    invalidateQuotaCache()
    // Emitir warning SSE si la cuota supera algún threshold configurado
    setImmediate(() => {
      try {
        const cfg  = readConfig()
        const data = computeQuota(cfg.plan ?? undefined)
        const level = getWarnLevel(data.cyclePct, cfg.warnThresholds)
        if (level) {
          broadcast({
            type: 'quota_warning',
            payload: {
              level,
              cyclePct:  data.cyclePct,
              cycleLimit: data.cycleLimit,
              resetMs:   data.cycleResetMs,
              blocked:   cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold,
            }
          })
        }
      } catch { /* ignorar errores al calcular quota */ }
    })
    // Generar resumen IA solo si el usuario lo activa explícitamente
    // Activar: CLAUDETRACE_AI_SUMMARY=true claudetrace start
    if (process.env.CLAUDETRACE_AI_SUMMARY === 'true') {
      setImmediate(async () => {
        try {
          const session = dbOps.getSession(session_id)
          if (!session) return
          const events      = dbOps.getSessionEvents(session_id)
          const projectName = session.project_path ? path.basename(session.project_path) : undefined
          const summary     = await summarizeSession(events, session.total_cost_usd ?? 0, projectName)
          if (summary) {
            dbOps.updateSessionSummary(session_id, summary)
            broadcast({ type: 'summary_ready', payload: { session_id, summary } })
          }
        } catch { /* ignorar errores del summarizer */ }
      })
    }
  }

  res.json({ ok: true })
})

// ─── GET /stream — SSE para claudetrace watch ─────────────────────────────────

app.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  const clientId = Math.random().toString(36).slice(2)
  sseClients.set(clientId, res)

  // Estado inicial: sesión más reciente con todos sus eventos
  const latestSession = dbOps.getLatestSession()
  if (latestSession) {
    const events  = dbOps.getSessionEvents(latestSession.id)
    const lastEvt = sessionLastEvent.get(latestSession.id)
    const state   = deriveSessionState(lastEvt?.type, lastEvt?.ts ?? latestSession.last_event_at ?? latestSession.started_at)
    res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events })}\n\n`)

    // Procesar el JSONL de la sesión activa para entregar contexto inmediato
    // (sin esperar al próximo mensaje de Claude)
    setImmediate(() => processLatestForSession(latestSession.id, onCostUpdate))
  }

  req.on('close', () => sseClients.delete(clientId))
})

// ─── Helpers de proyecto ─────────────────────────────────────────────────────

/** Sube el árbol desde un file_path hasta encontrar HANDOFF.md → directorio del proyecto */
function findProjectCwdForFile(filePath: string): string | undefined {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'HANDOFF.md'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Infiere el proyecto activo mirando los eventos de archivo de una sesión */
function inferProjectCwd(events: EventRow[]): string | undefined {
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep'])
  for (const ev of [...events].reverse()) {
    if (!FILE_TOOLS.has(ev.tool_name || '')) continue
    if (!ev.tool_input) continue
    try {
      const inp      = JSON.parse(ev.tool_input)
      const filePath = (inp.file_path || inp.path) as string | undefined
      if (!filePath?.startsWith('/')) continue
      const cwd = findProjectCwdForFile(filePath)
      if (cwd) return cwd
    } catch { /* ignorar */ }
  }
  return undefined
}

// ─── GET /projects — listado de proyectos con stats ──────────────────────────

app.get('/projects', (_req: Request, res: Response) => {
  // Proyectos del DB (ya etiquetados)
  const dbAggregates: any[] = dbOps.getProjectAggregates()

  // Proyectos descubiertos del filesystem (cacheados — pre-computados al arrancar)
  const scanned = getProjectsCached()

  // Obtener proyecto activo
  const latestSession = dbOps.getLatestSession()
  const latestEvents  = latestSession ? dbOps.getSessionEvents(latestSession.id) : []
  const activeProject = latestSession?.project_path
    ?? inferProjectCwd(latestEvents)
    ?? null

  // Merge: DB stats + filesystem scan
  const projectMap = new Map<string, any>()

  for (const agg of dbAggregates) {
    projectMap.set(agg.project_path, {
      path:           agg.project_path,
      name:           path.basename(agg.project_path),
      session_count:  agg.session_count,
      total_cost_usd: agg.total_cost_usd,
      total_tokens:   (agg.total_input_tokens ?? 0) + (agg.total_output_tokens ?? 0),
      last_active:    agg.last_active,
      avg_efficiency: agg.avg_efficiency ? Math.round(agg.avg_efficiency) : null,
      progress: { done: 0, total: 0, pct: 0, nextTask: null },
      has_handoff: false,
    })
  }

  for (const scan of scanned) {
    const dbEntry    = projectMap.get(scan.path)
    const useJSONL   = !dbEntry || dbEntry.session_count === 0
    const jStats     = scan.jsonlStats

    const base = dbEntry ?? {
      path: scan.path, name: scan.name,
      session_count: 0, total_cost_usd: 0, total_tokens: 0,
      last_active: null, avg_efficiency: null,
    }

    projectMap.set(scan.path, {
      ...base,
      // Si la DB no tiene sesiones, usar datos de JSONL históricos
      session_count:  useJSONL ? jStats.session_count  : base.session_count,
      total_cost_usd: useJSONL ? jStats.total_cost_usd : base.total_cost_usd,
      total_tokens:   useJSONL ? jStats.total_tokens   : base.total_tokens,
      last_active:    useJSONL ? jStats.last_active     : base.last_active,
      has_handoff:    scan.hasHandoff,
      auto_handoff:   scan.autoHandoff,
      progress:       scan.progress,
      model_usage:    jStats.modelUsage,  // siempre desde JSONL — más preciso que la DB
      jsonl_source:   useJSONL,
    })
  }

  const projects = [...projectMap.values()]
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))

  res.json({ projects, active_project: activeProject })
})

// ─── GET /history — sesiones agrupadas por día ────────────────────────────────

app.get('/history', (_req: Request, res: Response) => {
  const sessions = dbOps.getRecentSessions(30)

  // Agrupar por fecha local (YYYY-MM-DD)
  const byDate = new Map<string, any[]>()

  for (const s of sessions) {
    const date = new Date(s.started_at).toISOString().slice(0, 10)
    if (!byDate.has(date)) byDate.set(date, [])

    // Detectar modo desde los contadores precalculados en la query
    const hasAgent = (s.agent_count ?? 0) > 0
    const hasSkill = (s.skill_count  ?? 0) > 0
    const mode = hasAgent && hasSkill ? 'agentes+skills'
      : hasAgent ? 'agentes' : hasSkill ? 'skills' : 'directo'

    // Git info cacheada para este proyecto
    const gitInfo = s.project_path ? getCachedGitInfo(s.project_path) : null

    byDate.get(date)!.push({
      id:             s.id,
      project_path:   s.project_path ?? null,
      project_name:   s.project_path ? path.basename(s.project_path) : null,
      started_at:     s.started_at,
      last_event_at:  s.last_event_at ?? s.started_at,
      duration_ms:    (s.last_event_at ?? s.started_at) - s.started_at,
      total_cost_usd: s.total_cost_usd    ?? 0,
      total_tokens:   (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0),
      efficiency_score: s.efficiency_score ?? 100,
      loops_detected:   s.loops_detected  ?? 0,
      done_count:       s.done_count      ?? 0,
      top_tools:        s.top_tools_csv   ? (s.top_tools_csv as string).split(',') : [],
      mode,
      ai_summary:   (s as any).ai_summary ?? null,
      git_branch:   gitInfo?.branch       ?? null,
      git_dirty:    gitInfo?.dirty        ?? false,
      git_ahead:    gitInfo?.ahead        ?? 0,
      git_behind:   gitInfo?.behind       ?? 0,
    })
  }

  const days = [...byDate.entries()]
    .map(([date, sessions]) => ({
      date,
      sessions,
      total_cost:    sessions.reduce((s, x) => s + x.total_cost_usd, 0),
      total_tokens:  sessions.reduce((s, x) => s + x.total_tokens,   0),
      total_duration_ms: sessions.reduce((s, x) => s + x.duration_ms, 0),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  res.json({ days })
})

// ─── GET /git?path=... — git info para un proyecto ────────────────────────────

app.get('/git', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Falta parámetro path' }); return }
  res.json(getCachedGitInfo(projectPath) ?? null)
})

// ─── GET /pr?path=... — estado del PR para un proyecto ────────────────────────

app.get('/pr', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Falta parámetro path' }); return }
  res.json(getCachedPRStatus(projectPath) ?? null)
})

// ─── GET /meta-stats — KPIs de contexto ──────────────────────────────────────

app.get('/meta-stats', (_req: Request, res: Response) => {
  const latestSession = dbOps.getLatestSession()
  const events        = latestSession ? dbOps.getSessionEvents(latestSession.id) : []

  // Inferir el directorio del proyecto desde los eventos (más fiable que el cwd del daemon)
  const projectCwd = inferProjectCwd(events) ?? latestSession?.cwd ?? undefined

  const current = computeMetaStats(projectCwd)
  const history  = getMetaHistory()

  res.json({ current, history })
})

// ─── GET /intelligence/:sessionId — reporte de inteligencia ──────────────────

app.get('/intelligence/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params
  const session = dbOps.getSession(sessionId)
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  const events = dbOps.getSessionEvents(sessionId)
  const report = analyzeSession(events, session.total_cost_usd ?? 0)
  res.json({ sessionId, ...report })
})

// ─── GET /quota — datos de cuota y burn rate ──────────────────────────────────

app.get('/quota', (_req: Request, res: Response) => {
  try {
    const cfg  = readConfig()
    const data = computeQuota(cfg.plan ?? undefined)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Error calculando quota' })
  }
})

// ─── GET /kill-switch — consultado por el hook PreToolUse ─────────────────────
// Si está bloqueado, el hook hace exit(2) y Claude Code cancela la acción.

app.get('/kill-switch', (_req: Request, res: Response) => {
  try {
    const cfg  = readConfig()
    const data = computeQuota(cfg.plan ?? undefined)

    const blocked = cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold
    const reason  = blocked
      ? `Cuota 5h al ${data.cyclePct}% (límite: ${cfg.killSwitchThreshold}%). Reset en ${formatMs(data.cycleResetMs)}.`
      : undefined

    res.json({ blocked, reason, cyclePct: data.cyclePct })
  } catch {
    res.json({ blocked: false })  // si hay error, no bloquear
  }
})

/** Formatea ms a "Xh Ym" legible */
function formatMs(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ─── GET /sessions — listado para dashboard futuro ────────────────────────────

app.get('/sessions', (_req: Request, res: Response) => {
  const sessions = dbOps.getAllSessions()
  // Enriquecer cada sesión con el estado derivado en tiempo real
  const enriched = sessions.map(s => {
    const lastEvt = sessionLastEvent.get(s.id)
    const ts      = lastEvt?.ts ?? s.last_event_at ?? s.started_at
    const state   = deriveSessionState(lastEvt?.type, ts)
    return { ...s, state }
  })
  res.json(enriched)
})

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: sseClients.size })
})

// ─── Dashboard React (servir estáticos del build de Vite) ────────────────────

const DASHBOARD_DIST = path.join(__dirname, '..', 'dashboard', 'dist')
app.use(express.static(DASHBOARD_DIST))

// SPA fallback: cualquier ruta no capturada sirve index.html
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(DASHBOARD_DIST, 'index.html'))
})

// ─── Callback del enricher ────────────────────────────────────────────────────

/**
 * Cuando el enricher detecta nuevos tokens en un JSONL:
 * 1. Corre el análisis de inteligencia
 * 2. Guarda el coste + score en DB
 * 3. Hace broadcast vía SSE para que el watch muestre el coste actualizado
 */
const onCostUpdate: CostUpdateCallback = (sessionId, cost) => {
  const events  = dbOps.getSessionEvents(sessionId)
  const report  = analyzeSession(events, cost.cost_usd)

  dbOps.updateSessionCost(sessionId, cost, report.efficiencyScore, report.loops.length)

  broadcast({
    type: 'cost_update',
    payload: {
      session_id:       sessionId,
      cost_usd:         cost.cost_usd,
      input_tokens:     cost.input_tokens,
      output_tokens:    cost.output_tokens,
      cache_read:       cost.cache_read,
      cache_creation:   cost.cache_creation,
      context_used:     cost.context_used,
      context_window:   cost.context_window,
      efficiency_score: report.efficiencyScore,
      loops:            report.loops,
      summary:          report.summary
    }
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

// ─── Callback de auto-compact ────────────────────────────────────────────────

const onCompactDetected: CompactDetectedCallback = (sessionId) => {
  broadcast({ type: 'compact_detected', payload: { session_id: sessionId, ts: Date.now() } })
  console.log(`[daemon] Auto-compact detectado para sesión ${sessionId.slice(0, 8)}`)
}

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
  if (tagged > 0) console.log(`[daemon] ${tagged} sesiones etiquetadas con proyecto`)
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
    } catch { /* ignorar errores individuales */ }
  }
}

export function startDaemon() {
  app.listen(PORT, () => {
    console.log(`\n● claudetrace daemon  →  http://localhost:${PORT}`)
    console.log(`  Esperando eventos de Claude Code...\n`)
    console.log(`  En otra terminal: \x1b[36mclaudetrace watch\x1b[0m\n`)

    // Etiquetar sesiones históricas que no tienen proyecto asignado
    migrateSessionProjects()

    // Pre-scan de proyectos al arrancar — garantiza respuesta inmediata en el tab
    // Se ejecuta en background para no retrasar el inicio del servidor
    setImmediate(() => {
      getProjectsCached()
      console.log(`[daemon] ${_projectsCache?.length ?? 0} proyectos escaneados`)
    })

    // Refresh automático del cache de proyectos cada 2 minutos
    // Recoge cambios en HANDOFF.md aunque el daemon lleve horas corriendo
    setInterval(() => {
      invalidateProjectsCache()
      getProjectsCached()
    }, PROJECTS_CACHE_TTL)

    // Iniciar el watcher de JSONL para enriquecimiento de coste
    startEnricher(onCostUpdate, onCompactDetected)

    // Summaries IA solo si opt-in explícito (CLAUDETRACE_AI_SUMMARY=true)
    if (process.env.CLAUDETRACE_AI_SUMMARY === 'true') {
      migrateSessionSummaries(5).catch(() => {})
    }
  })
}
