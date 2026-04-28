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
import { startEnricher, processLatestForSession, getAllBlockCostsForSession,
         getSessionPrompts,
         type CostUpdateCallback,
         type CompactDetectedCallback }                       from './enricher'
import { analyzeSession }                                     from './intelligence'
import { computeMetaStats, getMetaHistory }                   from './meta-stats'
import { discoverProjects, parseHandoffProgress }             from './project-scanner'
import { deriveSessionState, STATE_META }                     from './session-state'
import { computeQuota, invalidateQuotaCache }                 from './quota-tracker'
import { readConfig, writeConfig, getWarnLevel, validateConfig, type ClaudetraceConfig } from './config'
import { getGitInfo, type GitInfo }                           from './git'
import { getPRStatus, type PRStatus }                         from './github'
import { analyzePatterns }                                    from './pattern-analyzer'
import { summarizeSession }                                   from './summarizer'
import { readClaudeStats }                                    from './claude-stats'

const PORT = 7337
const app  = express()
app.use(express.json())

// Clientes SSE conectados — uno por cada `claudestat watch` abierto
const sseClients = new Map<string, Response>()

// Estado de sesión en memoria — se deriva a demanda, no se persiste en DB.
// Clave: session_id  Valor: {type, ts} del último evento recibido vía /event
const sessionLastEvent = new Map<string, { type: string; ts: number }>()

// Skill activa por sesión — se setea tras Skill Done, se limpia en Stop.
// Permite taggear los eventos siguientes con skill_parent para agruparlos en la UI.
const activeSkillBySession = new Map<string, string>()

// Último Agent PreToolUse por CWD — se usa para detectar sub-sesiones de agentes.
// Clave: cwd  Valor: { pre_ts, session_id }
const lastAgentByCwd = new Map<string, { pre_ts: number; session_id: string }>()

// Sesiones ya evaluadas para taggeo de parent — evita re-evaluar en cada cost update.
const taggedSessionParents = new Set<string>()

// ─── Quota alerter: moving average de 3 muestras + cooldown 1h por nivel ─────
// Evita falsas alarmas por spikes puntuales. Solo emite si el promedio de las
// últimas 3 lecturas supera el threshold Y no se emitió ese nivel en la última hora.

const quotaSamples: number[] = []            // últimas 3 lecturas de cyclePct
const alertCooldown = new Map<string, number>() // nivel → timestamp del último aviso
const ALERT_COOLDOWN_MS = 60 * 60 * 1000    // 1 hora
const SAMPLES_NEEDED    = 3                  // muestras para el moving average

function shouldFireAlert(level: 'yellow' | 'orange' | 'red', pct: number): boolean {
  // Añadir muestra al buffer circular (máx SAMPLES_NEEDED)
  quotaSamples.push(pct)
  if (quotaSamples.length > SAMPLES_NEEDED) quotaSamples.shift()

  // Necesitamos SAMPLES_NEEDED lecturas antes de disparar (evita alert en el primer spike)
  if (quotaSamples.length < SAMPLES_NEEDED) return false

  // Cooldown: no repetir el mismo nivel en la última hora
  const lastFired = alertCooldown.get(level) ?? 0
  if (Date.now() - lastFired < ALERT_COOLDOWN_MS) return false

  alertCooldown.set(level, Date.now())
  return true
}

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

// ─── Rate limiter simple para POST /event ────────────────────────────────────
// Protege contra flood local. Límite: 120 requests/min por IP.
// Usa ventana fija de 60s para simplicidad (sin dependencias externas).

const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(ip: string): boolean {
  const now  = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// Limpiar entradas expiradas cada 5 minutos para no acumular IPs inactivas
setInterval(() => {
  const now = Date.now()
  rateLimitMap.forEach((v, k) => { if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(k) })
}, 5 * 60_000)

function broadcast(msg: object) {
  let data: string
  try {
    data = `data: ${JSON.stringify(msg)}\n\n`
  } catch {
    return  // objeto no serializable (ej: referencia circular) — ignorar silenciosamente
  }
  const dead: string[] = []
  sseClients.forEach((client, id) => {
    try {
      client.write(data)
    } catch {
      dead.push(id)  // socket cerrado o roto — marcar para eliminar
    }
  })
  // Limpiar clientes muertos fuera del forEach para no mutar el Map mientras se itera
  dead.forEach(id => sseClients.delete(id))
}

// ─── POST /event — recibe eventos de los hooks de Claude Code ─────────────────

app.post('/event', (req: Request, res: Response) => {
  const ip = req.ip ?? '127.0.0.1'
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Demasiadas peticiones — espera 1 minuto' })
    return
  }

  const { type, session_id, tool_name, tool_input, tool_response, ts, cwd, transcript_path } = req.body

  if (!session_id || !type) {
    res.status(400).json({ error: 'Faltan session_id o type' })
    return
  }

  const resolvedCwd = cwd
    ?? (transcript_path ? transcript_path.split('/').slice(0, -1).join('/') : undefined)

  dbOps.upsertSession({ id: session_id, cwd: resolvedCwd, started_at: ts, last_event_at: ts })

  // Skill grouping: get current parent BEFORE processing this event
  // (the Skill Done event itself is NOT tagged — only its subsequent sub-calls are)
  const skillParent = (tool_name !== 'Skill' && type !== 'Stop')
    ? activeSkillBySession.get(session_id)
    : undefined

  if (type === 'PostToolUse' && tool_name) {
    const pairedId = dbOps.pairPostWithPre(
      session_id, tool_name,
      typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? ''),
      ts
    )
    // Truncar tool_response a 4000 chars para no saturar SSE con archivos grandes
    const rawResp  = typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response ?? '')
    const tool_output = rawResp.length > 4000
      ? rawResp.slice(0, 4000) + `\n…[truncado: ${rawResp.length} chars]`
      : rawResp
    broadcast({ type: 'event', payload: { type: 'Done', session_id, tool_name, tool_input: tool_input != null ? JSON.stringify(tool_input) : undefined, tool_output, ts, pairedId, skill_parent: skillParent } })

    // Activar skill parent para los eventos siguientes si este fue un Skill Done
    if (tool_name === 'Skill') {
      try {
        const inp = typeof tool_input === 'object' ? tool_input : JSON.parse(tool_input ?? '{}')
        activeSkillBySession.set(session_id, inp?.skill || inp?.name || 'skill')
      } catch { activeSkillBySession.set(session_id, 'skill') }
    }
  } else {
    dbOps.insertEvent({
      session_id, type,
      tool_name: tool_name ?? undefined,
      tool_input: tool_input ? JSON.stringify(tool_input) : undefined,
      ts, cwd: resolvedCwd, skill_parent: skillParent
    })
    broadcast({ type: 'event', payload: { ...req.body, skill_parent: skillParent } })

    // Stop limpia el skill activo para esta sesión
    if (type === 'Stop') activeSkillBySession.delete(session_id)

    // Registrar Agent PreToolUse para detección de sub-sesiones
    if (type === 'PreToolUse' && tool_name === 'Agent' && resolvedCwd) {
      lastAgentByCwd.set(resolvedCwd, { pre_ts: ts, session_id })
    }
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
    // Emitir warning SSE si la cuota supera algún threshold (moving avg 3 muestras + cooldown 1h)
    setImmediate(() => {
      try {
        const cfg   = readConfig()
        const data  = computeQuota(cfg.plan ?? undefined)
        const level = getWarnLevel(data.cyclePct, cfg.warnThresholds)
        // shouldFireAlert acumula siempre la muestra; devuelve true solo si avg estable + cooldown ok
        if (level && shouldFireAlert(level, data.cyclePct)) {
          broadcast({
            type: 'quota_warning',
            payload: {
              level,
              cyclePct:   data.cyclePct,
              cycleLimit: data.cycleLimit,
              resetMs:    data.cycleResetMs,
              blocked:    cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold,
            }
          })
        } else if (!level) {
          // Sin nivel activo → alimentar el buffer igualmente para que las próximas muestras sean correctas
          quotaSamples.push(data.cyclePct)
          if (quotaSamples.length > SAMPLES_NEEDED) quotaSamples.shift()
        }
      } catch { /* ignorar errores al calcular quota */ }
    })
    // Generar resumen IA solo si el usuario lo activa explícitamente
    // Activar: CLAUDESTAT_AI_SUMMARY=true claudestat start
    if (process.env.CLAUDESTAT_AI_SUMMARY === 'true') {
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

// ─── GET /stream — SSE para claudestat watch ─────────────────────────────────

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
    const events     = dbOps.getSessionEvents(latestSession.id)
    const lastEvt    = sessionLastEvent.get(latestSession.id)
    const state      = deriveSessionState(lastEvt?.type, lastEvt?.ts ?? latestSession.last_event_at ?? latestSession.started_at)
    const blockCosts      = getAllBlockCostsForSession(latestSession.id)
    const subAgentSessions = dbOps.getChildSessions(latestSession.id)
    res.write(`data: ${JSON.stringify({ type: 'init', session: { ...latestSession, state }, events, blockCosts, subAgentSessions })}\n\n`)

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

/**
 * Determina el proyecto activo por mayoría de operaciones de archivo
 * en una ventana de tiempo reciente. Evita que un único archivo tocado
 * de otro proyecto cambie el badge.
 *
 * - Mínimo 2 hits en la ventana para declarar un proyecto como activo.
 * - Si hay empate, gana el que tuvo actividad más reciente.
 */
function inferActiveProjectByMajority(events: EventRow[], windowMs: number): string | undefined {
  const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep'])
  const cutoff     = Date.now() - windowMs

  const hits = new Map<string, { count: number; lastTs: number }>()

  for (const ev of events) {
    if ((ev.ts ?? 0) < cutoff) continue
    if (!FILE_TOOLS.has(ev.tool_name || '')) continue
    if (!ev.tool_input) continue
    try {
      const inp      = JSON.parse(ev.tool_input)
      const filePath = (inp.file_path || inp.path) as string | undefined
      if (!filePath?.startsWith('/')) continue
      const project = findProjectCwdForFile(filePath)
      if (!project) continue
      const entry = hits.get(project) ?? { count: 0, lastTs: 0 }
      hits.set(project, { count: entry.count + 1, lastTs: Math.max(entry.lastTs, ev.ts ?? 0) })
    } catch { /* ignorar */ }
  }

  if (hits.size === 0) return undefined

  // Ordenar por hits desc, luego por timestamp desc en caso de empate
  const sorted = [...hits.entries()].sort(([, a], [, b]) =>
    b.count !== a.count ? b.count - a.count : b.lastTs - a.lastTs
  )

  const [topProject, topStats] = sorted[0]
  return topStats.count >= 2 ? topProject : undefined
}

// ─── GET /projects — listado de proyectos con stats ──────────────────────────

app.get('/projects', (_req: Request, res: Response) => {
  // Proyectos del DB (ya etiquetados)
  const dbAggregates: any[] = dbOps.getProjectAggregates()

  // Proyectos descubiertos del filesystem (cacheados — pre-computados al arrancar)
  const scanned = getProjectsCached()

  // Obtener proyecto activo — mayoría en ventana de 10 min, luego fallbacks
  const latestSession = dbOps.getLatestSession()
  const latestEvents  = latestSession ? dbOps.getSessionEvents(latestSession.id) : []
  const activeProject = inferActiveProjectByMajority(latestEvents, 10 * 60_000)
    ?? latestSession?.project_path
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
      total_tokens:   (agg.total_input_tokens ?? 0) + (agg.total_output_tokens ?? 0) + (agg.total_cache_read ?? 0),
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
      // session_count and last_active: max of DB (live) and JSONL (full history before claudestat install)
      session_count:  Math.max(jStats.session_count, base.session_count),
      last_active:    Math.max(jStats.last_active ?? 0, base.last_active ?? 0) || null,
      // cost and tokens: always from JSONL — covers full history, not just since claudestat install
      total_cost_usd: jStats.total_cost_usd,
      total_tokens:   jStats.total_tokens,
      has_handoff:    scan.hasHandoff,
      auto_handoff:   scan.autoHandoff,
      progress:       scan.progress,
      model_usage:    jStats.modelUsage,
      jsonl_source:   useJSONL,
    })
  }

  // Attach pattern insights per project (only if DB has enough data)
  const projects = [...projectMap.values()].map(p => {
    const toolCounts  = dbOps.getProjectToolCounts(p.path)
    const sessionStats = dbOps.getProjectSessionStats(p.path)
    const insights = (sessionStats && sessionStats.session_count >= 2)
      ? analyzePatterns(toolCounts, sessionStats)
      : []
    return { ...p, insights }
  })
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))

  res.json({ projects, active_project: activeProject })
})

// ─── GET /history — sesiones agrupadas por día ────────────────────────────────

app.get('/history', (_req: Request, res: Response) => {
  const sessions = dbOps.getRecentSessions(30)

  // Agrupar por fecha local (YYYY-MM-DD)
  const byDate = new Map<string, any[]>()

  for (const s of sessions) {
    // toLocaleDateString('en-CA') produce YYYY-MM-DD en la zona horaria local del usuario
    const date = new Date(s.started_at).toLocaleDateString('en-CA')
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
      total_tokens:   (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0) + (s.total_cache_read ?? 0),
      efficiency_score: s.efficiency_score ?? 100,
      loops_detected:   s.loops_detected  ?? 0,
      done_count:       s.done_count      ?? 0,
      top_tools:        s.top_tools_csv   ? (() => { try { return JSON.parse(s.top_tools_csv as string) } catch { return [] } })() : [],
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

// ─── GET /prompts — mensajes del usuario para una sesión ─────────────────────

app.get('/prompts', (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string | undefined
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  res.json({ prompts: getSessionPrompts(sessionId) })
})

// ─── GET /hidden-cost — coste oculto en loops (últimos 7 días) ───────────────

app.get('/hidden-cost', (_req: Request, res: Response) => {
  res.json(dbOps.getHiddenCostStats(7))
})

// ─── GET /claude-stats — actividad de ~/.claude/stats-cache.json ─────────────

app.get('/claude-stats', (_req: Request, res: Response) => {
  res.json(readClaudeStats())
})

// ─── GET /system-config — mapa completo del setup de Claude ──────────────────

let _systemConfigCache: unknown = null
let _systemConfigCacheTs = 0
const SYSTEM_CONFIG_TTL = 30_000

app.get('/system-config', (_req: Request, res: Response) => {
  if (_systemConfigCache && Date.now() - _systemConfigCacheTs < SYSTEM_CONFIG_TTL) {
    res.json(_systemConfigCache)
    return
  }
  try {
    const home = os.homedir()

    // 1. Hooks desde ~/.claude/settings.json
    // Claude Code almacena hooks en formato anidado: cada entrada tiene un array `hooks` interno.
    // Aplanamos a { matcher, command } porque el dashboard solo necesita mostrar el comando final.
    interface RawHookEntry { matcher?: string; hooks: Array<{ type: string; command: string }> }
    let hooks: Record<string, { matcher?: string; command: string }[]> = {}
    try {
      const raw      = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8')
      const rawHooks = JSON.parse(raw).hooks as Record<string, RawHookEntry[]> ?? {}
      for (const [event, entries] of Object.entries(rawHooks)) {
        hooks[event] = entries.flatMap(e =>
          (e.hooks ?? []).map(h => ({ matcher: e.matcher, command: h.command }))
        )
      }
    } catch {}

    // Helper compartido — agentes y skills tienen la misma estructura de archivo .md con frontmatter
    const scanMarkdownDir = (dir: string, excludes: string[] = []) => {
      const items: { name: string; description: string; lines: number }[] = []
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && !excludes.includes(f))) {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8')
        const desc    = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
        items.push({ name: f.replace('.md', ''), description: desc, lines: content.split('\n').length })
      }
      return items
    }

    // 2. Agentes desde ~/.claude/agents/ (excluye archivos de sistema — no son agentes invocables)
    let agents: { name: string; description: string; lines: number }[] = []
    try { agents = scanMarkdownDir(path.join(home, '.claude', 'agents'), ['CLAUDE.md', 'ORCHESTRATOR.md', 'AGENTS.md']) } catch {}

    // 2b. Workflows desde ~/.claude/agents/workflows/
    let workflows: { name: string; description: string; lines: number }[] = []
    try { workflows = scanMarkdownDir(path.join(home, '.claude', 'agents', 'workflows')) } catch {}

    // 3. Archivos de contexto relevantes
    const engramSlugCtx  = home.replace(/\//g, '-')
    const contextPaths = [
      { key: 'CLAUDE.md global',  filePath: path.join(home, '.claude', 'CLAUDE.md') },
      { key: 'MEMORY.md',         filePath: path.join(home, '.claude', 'projects', engramSlugCtx, 'memory', 'MEMORY.md') },
      { key: 'settings.json',     filePath: path.join(home, '.claude', 'settings.json') },
      { key: 'config claudestat',filePath: path.join(home, '.claudestat', 'config.json') },
    ]
    const contextFiles = contextPaths.map(({ key, filePath }) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines   = content.split('\n').length
        const sizeKb  = Math.round(Buffer.byteLength(content, 'utf-8') / 1024 * 10) / 10
        return { key, exists: true, sizeKb, lines }
      } catch {
        return { key, exists: false, sizeKb: 0, lines: 0 }
      }
    })

    // 3b. Skills desde ~/.claude/commands/
    let skills: { name: string; description: string; lines: number }[] = []
    try { skills = scanMarkdownDir(path.join(home, '.claude', 'commands')) } catch {}

    // 4. Archivos de memoria Engram — slug deriva de homedir: /Users/db → -Users-db
    let memoryFiles: string[] = []
    try {
      const memDir = path.join(home, '.claude', 'projects', engramSlugCtx, 'memory')
      memoryFiles  = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort()
    } catch {}

    // 5. Distribución de modos (últimos 7 días)
    const modeDistribution = dbOps.getModeDistribution(7)

    // 6. Config de claudestat
    const claudestatConfig = readConfig()

    _systemConfigCache = { hooks, agents, workflows, skills, contextFiles, memoryFiles, modeDistribution, claudestatConfig }
    _systemConfigCacheTs = Date.now()
    res.json(_systemConfigCache)
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo config del sistema' })
  }
})

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT, clients: sseClients.size })
})

// ─── GET /config — leer configuración ────────────────────────────────────────

app.get('/config', (_req: Request, res: Response) => {
  res.json(readConfig())
})

// ─── PUT /config — guardar configuración ─────────────────────────────────────

app.put('/config', (req: Request, res: Response) => {
  const validationError = validateConfig(req.body)
  if (validationError) { res.status(400).json({ error: validationError }); return }
  try {
    const current = readConfig()
    writeConfig({ ...current, ...req.body })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── POST /api/weekly-reports — guardar reporte generado por weekly-review.sh ─

app.post('/api/weekly-reports', (req: Request, res: Response) => {
  const { date, content } = req.body as { date?: string; content?: string }
  if (!date || !content) {
    res.status(400).json({ error: 'date y content son requeridos' })
    return
  }
  try {
    dbOps.insertWeeklyReport(date, content)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ─── GET /api/analytics — datos diarios agrupados para la vista Analytics ────

app.get('/api/analytics', (req: Request, res: Response) => {
  const days        = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 90)
  const projectDays = Math.min(parseInt(String(req.query.project_days ?? String(days)), 10) || days, 90)
  const since        = Date.now() - days        * 24 * 60 * 60 * 1000
  const projectSince = Date.now() - projectDays * 24 * 60 * 60 * 1000

  const daily        = dbOps.getAnalyticsDaily(since)
  const byModel      = dbOps.getAnalyticsByModel(since)
  const projectHours = dbOps.getProjectHours(projectSince)

  // KPIs (siempre sobre últimos 7d y 30d, independiente del período pedido)
  const now7  = Date.now() - 7  * 24 * 60 * 60 * 1000
  const now30 = Date.now() - 30 * 24 * 60 * 60 * 1000
  const week  = daily.filter(d => new Date(d.date + 'T12:00:00').getTime() >= now7)
  const month = daily.filter(d => new Date(d.date + 'T12:00:00').getTime() >= now30)

  const sum = (arr: typeof daily, k: keyof typeof daily[0]) =>
    arr.reduce((a, d) => a + (d[k] as number), 0)
  const avg = (arr: typeof daily, k: keyof typeof daily[0]) =>
    arr.length ? sum(arr, k) / arr.length : 0

  res.json({
    daily,
    by_model: byModel,
    project_hours: projectHours,
    kpis: {
      week_cost:       sum(week,  'cost'),
      month_cost:      sum(month, 'cost'),
      week_sessions:   sum(week,  'sessions'),
      month_sessions:  sum(month, 'sessions'),
      week_loops:      sum(week,  'loops'),
      avg_efficiency:  Math.round(avg(week, 'avg_efficiency')),
    },
  })
})

// ─── POST /api/weekly-reports/generate-now — generar informe inmediatamente ───

app.post('/api/weekly-reports/generate-now', (_req: Request, res: Response) => {
  const cfg       = readConfig()
  const dateLabel = new Date().toISOString().slice(0, 10)
  if (dbOps.getWeeklyReportByDate(dateLabel)) {
    res.json({ skipped: true, date: dateLabel })
    return
  }
  const markdown = generateReport(dateLabel, cfg)
  dbOps.insertWeeklyReport(dateLabel, markdown)
  console.log(`[daemon] Informe generado manualmente: ${dateLabel}`)
  res.json({ ok: true, date: dateLabel })
})

// ─── POST /api/weekly-reports/import-local — importar .md desde ~/.claude/reports ─

app.post('/api/weekly-reports/import-local', (_req: Request, res: Response) => {
  const reportsDir = path.join(os.homedir(), '.claude', 'reports')
  if (!fs.existsSync(reportsDir)) {
    res.json({ imported: 0, skipped: 0 })
    return
  }
  const files = fs.readdirSync(reportsDir).filter(f => /^weekly-\d{4}-\d{2}-\d{2}\.md$/.test(f))
  let imported = 0, skipped = 0
  for (const file of files) {
    const date = file.replace('weekly-', '').replace('.md', '') // YYYY-MM-DD
    const existing = dbOps.getWeeklyReportByDate(date)
    if (existing) { skipped++; continue }
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf8')
    dbOps.insertWeeklyReport(date, content)
    imported++
  }
  res.json({ imported, skipped })
})

// ─── GET /api/weekly-reports — lista de reportes (id, date, preview) ──────────

app.get('/api/weekly-reports', (_req: Request, res: Response) => {
  res.json(dbOps.listWeeklyReports())
})

// ─── GET /api/weekly-reports/:date — reporte completo de una fecha ────────────

app.get('/api/weekly-reports/:date', (req: Request, res: Response) => {
  const report = dbOps.getWeeklyReportByDate(req.params.date)
  if (!report) { res.status(404).json({ error: 'not found' }); return }
  res.json(report)
})

// ─── GET /api/quota-stats — P90 de tokens y coste (últimos 30 días) ──────────

app.get('/api/quota-stats', (_req: Request, res: Response) => {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const rows = dbOps.getQuotaStats(since)
  if (rows.length === 0) {
    res.json({ p90Tokens: 0, p90Cost: 0, sessionCount: 0 })
    return
  }
  const idx = Math.floor(rows.length * 0.9)
  const p90Row = rows[Math.min(idx, rows.length - 1)]
  const sortedByCost = [...rows].sort((a, b) => a.total_cost_usd - b.total_cost_usd)
  const p90CostRow = sortedByCost[Math.min(idx, sortedByCost.length - 1)]
  res.json({ p90Tokens: p90Row.total_tokens, p90Cost: p90CostRow.total_cost_usd, sessionCount: rows.length })
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
  // Ensure session row exists — sub-agent JSONLs arrive from the enricher without a
  // prior hook event (Claude Code does not fire hooks for sub-agent sessions).
  let sessionRow = dbOps.getSession(sessionId)
  if (!sessionRow) {
    dbOps.upsertSession({ id: sessionId, cwd: undefined, started_at: cost.firstTs ?? Date.now(), last_event_at: cost.firstTs ?? Date.now() })
    sessionRow = dbOps.getSession(sessionId)
  }

  // Sub-agent detection: first time we see a session, check if its firstTs falls after
  // a recent Agent PreToolUse from another session in the same CWD → tag as child.
  if (!taggedSessionParents.has(sessionId) && cost.firstTs) {
    taggedSessionParents.add(sessionId)
    const cwd = sessionRow?.cwd
    if (cwd) {
      const agentInfo = lastAgentByCwd.get(cwd)
      if (agentInfo && agentInfo.session_id !== sessionId && agentInfo.pre_ts < cost.firstTs) {
        dbOps.updateSessionParent(sessionId, agentInfo.session_id)
      }
    }
  }

  const events  = dbOps.getSessionEvents(sessionId)
  const report  = analyzeSession(events, cost.cost_usd)

  dbOps.updateSessionCost(sessionId, cost, report.efficiencyScore, report.loops.length)

  const startedAt = sessionRow?.started_at ?? Date.now()
  const sessionDurationMinutes = (Date.now() - startedAt) / 60_000
  const projectedHourlyUsd = sessionDurationMinutes > 0.5
    ? cost.cost_usd / sessionDurationMinutes * 60
    : 0

  broadcast({
    type: 'cost_update',
    payload: {
      session_id:            sessionId,
      cost_usd:              cost.cost_usd,
      input_tokens:          cost.input_tokens,
      output_tokens:         cost.output_tokens,
      cache_read:            cost.cache_read,
      cache_creation:        cost.cache_creation,
      context_used:          cost.context_used,
      context_window:        cost.context_window,
      efficiency_score:      report.efficiencyScore,
      loops:                 report.loops,
      summary:               report.summary,
      model:                 cost.lastModel,
      projected_hourly_usd:  projectedHourlyUsd,
    }
  })

  // Emitir desglose de costo del último bloque (input vs output) para el TracePanel
  if (cost.lastEntry) {
    broadcast({
      type: 'block_cost',
      payload: {
        session_id:   sessionId,
        inputUsd:     cost.lastEntry.inputUsd,
        outputUsd:    cost.lastEntry.outputUsd,
        totalUsd:     cost.lastEntry.totalUsd,
        inputTokens:  cost.lastEntry.inputTokens,
        outputTokens: cost.lastEntry.outputTokens,
      }
    })
  }
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

// ─── Report scheduler ─────────────────────────────────────────────────────────

/** Número de semana ISO para lógica quincenal (semanas pares = informe). */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
}

/**
 * Devuelve el label YYYY-MM-DD si ahora es el momento de generar un informe,
 * o null si no corresponde todavía.
 */
function getReportDateLabel(now: Date, cfg: ClaudetraceConfig): string | null {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (hhmm !== cfg.reportTime) return null
  if (now.getDay() !== cfg.reportDay) return null

  if (cfg.reportFrequency === 'biweekly' && getISOWeek(now) % 2 !== 0) return null
  if (cfg.reportFrequency === 'monthly'  && now.getDate() > 7)          return null

  return now.toISOString().slice(0, 10)
}

/** Genera el markdown del informe para el período dado. */
function generateReport(dateLabel: string, cfg: ClaudetraceConfig): string {
  const periodDays = cfg.reportFrequency === 'monthly' ? 30 : cfg.reportFrequency === 'biweekly' ? 14 : 7
  const endMs      = Date.now()
  const startMs    = endMs - periodDays * 24 * 60 * 60 * 1000
  const fromDate   = new Date(startMs).toISOString().slice(0, 10)

  const sessions = dbOps.getAllSessions().filter(s => s.started_at >= startMs && s.started_at <= endMs)

  const totalCost    = sessions.reduce((a, s) => a + (s.total_cost_usd        ?? 0), 0)
  const totalInput   = sessions.reduce((a, s) => a + (s.total_input_tokens    ?? 0), 0)
  const totalOutput  = sessions.reduce((a, s) => a + (s.total_output_tokens   ?? 0), 0)
  const totalLoops   = sessions.reduce((a, s) => a + (s.loops_detected        ?? 0), 0)
  const avgEff       = sessions.length > 0
    ? Math.round(sessions.reduce((a, s) => a + (s.efficiency_score ?? 100), 0) / sessions.length)
    : 100

  const byProject = new Map<string, { sessions: number; cost: number }>()
  for (const s of sessions) {
    const key = s.project_path ? path.basename(s.project_path) : 'Sin proyecto'
    const cur = byProject.get(key) ?? { sessions: 0, cost: 0 }
    byProject.set(key, { sessions: cur.sessions + 1, cost: cur.cost + (s.total_cost_usd ?? 0) })
  }
  const topProjects = [...byProject.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5)

  const periodLabel = cfg.reportFrequency === 'monthly' ? 'mensual' : cfg.reportFrequency === 'biweekly' ? 'quincenal' : 'semanal'

  let md = `# Informe ${periodLabel} — ${dateLabel}\n\n`
  md += `> Período: ${fromDate} → ${dateLabel}\n\n`
  md += `## Resumen\n\n`
  md += `- **Sesiones**: ${sessions.length}\n`
  md += `- **Costo total**: $${totalCost.toFixed(4)}\n`
  md += `- **Tokens entrada**: ${(totalInput / 1_000_000).toFixed(2)}M\n`
  md += `- **Tokens salida**: ${(totalOutput / 1_000_000).toFixed(2)}M\n`
  md += `- **Eficiencia promedio**: ${avgEff}%\n`
  md += `- **Loops detectados**: ${totalLoops}\n\n`

  if (topProjects.length > 0) {
    md += `## Proyectos más activos\n\n`
    for (const [name, stats] of topProjects) {
      md += `- **${name}**: ${stats.sessions} sesión${stats.sessions !== 1 ? 'es' : ''} · $${stats.cost.toFixed(4)}\n`
    }
    md += '\n'
  }

  if (sessions.length === 0) {
    md += `> Sin actividad en este período.\n`
  }

  return md
}

const PID_FILE = `${process.env.HOME}/.claudestat/daemon.pid`

function writePid() {
  try {
    fs.mkdirSync(`${process.env.HOME}/.claudestat`, { recursive: true })
    fs.writeFileSync(PID_FILE, String(process.pid))
  } catch {}
}

function cleanPid() {
  try { fs.unlinkSync(PID_FILE) } catch {}
}

export function startDaemon() {
  const server = app.listen(PORT, '127.0.0.1', () => {
    writePid()
    process.on('exit', cleanPid)
    process.on('SIGTERM', () => { cleanPid(); process.exit(0) })
    process.on('SIGINT',  () => { cleanPid(); process.exit(0) })

    console.log(`\n● claudestat daemon  →  http://localhost:${PORT}`)
    console.log(`  Esperando eventos de Claude Code...\n`)
    console.log(`  En otra terminal: \x1b[36mclaudestat watch\x1b[0m\n`)

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

    // Scheduler de informes automáticos — corre cada minuto
    setInterval(() => {
      const cfg = readConfig()
      if (!cfg.reportsEnabled) return
      const dateLabel = getReportDateLabel(new Date(), cfg)
      if (!dateLabel) return
      if (dbOps.getWeeklyReportByDate(dateLabel)) return   // ya existe
      const markdown = generateReport(dateLabel, cfg)
      dbOps.insertWeeklyReport(dateLabel, markdown)
      console.log(`[daemon] Informe generado automáticamente: ${dateLabel}`)
    }, 60_000)

    // Summaries IA solo si opt-in explícito (CLAUDESTAT_AI_SUMMARY=true)
    if (process.env.CLAUDESTAT_AI_SUMMARY === 'true') {
      migrateSessionSummaries(5).catch(() => {})
    }
  })

  // Manejo de error de puerto ocupado — fuera del callback para capturar EADDRINUSE
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Error: El puerto ${PORT} ya está en uso.`)
      console.error(`   ¿Claudetrace ya está corriendo? Verifica con: lsof -i :${PORT}`)
      console.error(`   Si es así, no necesitas iniciarlo de nuevo.\n`)
      process.exit(1)
    }
    throw err
  })
}
