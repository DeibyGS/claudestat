// ─── Rutas misceláneas: /git, /pr, /meta-stats, /intelligence, /quota,
//     /kill-switch, /sessions, /prompts, /hidden-cost, /claude-stats,
//     /system-config, /config ─────────────────────────────────────────────────

import path from 'path'
import fs   from 'fs'
import os   from 'os'
import { Router, type Request, type Response } from 'express'
import { dbOps }                from '../db'
import { analyzeSession }       from '../intelligence'
import { computeMetaStats, getMetaHistory } from '../meta-stats'
import { computeQuota }         from '../quota-tracker'
import { readConfig, writeConfig, validateConfig } from '../config'
import { getSessionPrompts }    from '../enricher'
import { readClaudeStats }      from '../claude-stats'
import { getCachedGitInfo, getCachedPRStatus } from '../cache/projects-cache'
import { inferProjectCwd }      from './projects'
import { deriveSessionState }   from '../session-state'
import { sessionLastEvent, broadcast } from './stream'
import { getClaudeDir, getClaudestatDir, getOpencodeDir, getHomeSlug, getDaemonLogFile } from '../paths'
import { isSessionArchived } from '../watchers/opencode'
import { computeProjection }    from '../cost-projector'

export const miscRouter = Router()

// ─── GET /git?path=... — git info para un proyecto ────────────────────────────

miscRouter.get('/git', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Missing path parameter' }); return }
  res.json(getCachedGitInfo(projectPath) ?? null)
})

// ─── GET /pr?path=... — estado del PR para un proyecto ────────────────────────

miscRouter.get('/pr', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Missing path parameter' }); return }
  res.json(getCachedPRStatus(projectPath) ?? null)
})

// ─── GET /meta-stats — KPIs de contexto ──────────────────────────────────────

miscRouter.get('/meta-stats', (_req: Request, res: Response) => {
  const latestSession = dbOps.getLatestSession()
  const events        = latestSession ? dbOps.getSessionEvents(latestSession.id) : []

  // Inferir el directorio del proyecto desde los eventos (más fiable que el cwd del daemon)
  const projectCwd = inferProjectCwd(events) ?? latestSession?.cwd ?? undefined

  const current = computeMetaStats(projectCwd)
  const history  = getMetaHistory()

  res.json({ current, history })
})

// ─── GET /intelligence/:sessionId — reporte de inteligencia ──────────────────

miscRouter.get('/intelligence/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params
  const session = dbOps.getSession(sessionId)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  const events = dbOps.getSessionEvents(sessionId)
  const cfg    = readConfig()
  const report = analyzeSession(events, session.total_cost_usd ?? 0, cfg.loopThreshold, cfg.loopWindowSecs * 1000)
  res.json({ sessionId, ...report })
})

// ─── GET /quota — datos de cuota y burn rate ──────────────────────────────────

miscRouter.get('/quota', (_req: Request, res: Response) => {
  try {
    const cfg  = readConfig()
    const data = computeQuota(cfg.plan ?? undefined)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Error computing quota' })
  }
})

/** Formatea ms a "Xh Ym" legible */
function formatMs(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ─── GET /kill-switch — consultado por el hook PreToolUse ─────────────────────
// Si está bloqueado, el hook hace exit(2) y Claude Code cancela la acción.

miscRouter.get('/kill-switch', (_req: Request, res: Response) => {
  try {
    const cfg  = readConfig()
    const data = computeQuota(cfg.plan ?? undefined)

    const blocked = cfg.killSwitchEnabled && data.cyclePct >= cfg.killSwitchThreshold
    const reason  = blocked
      ? `Quota at ${data.cyclePct}% — kill switch threshold is ${cfg.killSwitchThreshold}%. Resets in ${formatMs(data.cycleResetMs)}.`
      : undefined

    res.json({ blocked, reason, cyclePct: data.cyclePct })
  } catch {
    res.json({ blocked: false })  // si hay error, no bloquear
  }
})

// ─── GET /sessions — listado para dashboard futuro ────────────────────────────

miscRouter.get('/sessions', (_req: Request, res: Response) => {
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

// ─── GET /api/session-events — todos los eventos de una sesión (sin límite) ──

miscRouter.get('/api/session-events', (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string | undefined
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  res.json({ events: dbOps.getSessionEvents(sessionId) })
})

// ─── GET /prompts — mensajes del usuario para una sesión ─────────────────────

miscRouter.get('/prompts', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string | undefined
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  res.json({ prompts: await getSessionPrompts(sessionId) })
})

// ─── GET /hidden-cost — coste oculto en loops (últimos 7 días) ───────────────

miscRouter.get('/hidden-cost', (_req: Request, res: Response) => {
  res.json(dbOps.getHiddenCostStats(7))
})

// ─── GET /claude-stats — actividad de ~/.claude/stats-cache.json ─────────────

miscRouter.get('/claude-stats', (_req: Request, res: Response) => {
  res.json(readClaudeStats())
})

// ─── GET /api/active-sessions — fuentes activas en los últimos 5 min ──────────

miscRouter.get('/api/active-sessions', (_req: Request, res: Response) => {
  const cutoff   = Date.now() - 30 * 60 * 1000
  const sessions = dbOps.getAllSessions()
  const KNOWN_SOURCES = new Set(['claude-code', 'opencode', 'codex', 'amp', 'droid', 'codebuff'])

  const result: Array<{
    source: string; sessionId: string; model: string; cost_usd: number; last_seen_ms: number
    input_tokens: number; output_tokens: number; cache_read: number; cache_creation: number
    project: string | null
  }> = []

  const activeIds = new Set(sessions.filter(s => (s.last_event_at ?? s.started_at) >= cutoff).map(s => s.id))
  const supersededIds = new Set(
    sessions.filter(s => s.parent_session_id && activeIds.has(s.parent_session_id)).map(s => s.parent_session_id!)
  )

  for (const s of sessions) {
    const lastSeen = s.last_event_at ?? s.started_at
    if (lastSeen < cutoff) continue
    const src = s.source ?? 'unknown'
    if (!KNOWN_SOURCES.has(src)) continue
    if (s.id.startsWith('agent-')) continue
    if (supersededIds.has(s.id)) continue
    if (s.parent_session_id && activeIds.has(s.parent_session_id)) {
      const parent = sessions.find(p => p.id === s.parent_session_id)
      const sameProject = parent && (parent.project_path ?? parent.cwd) === (s.project_path ?? s.cwd)
      if (sameProject) continue
    }
    if (src === 'opencode' && isSessionArchived(s.id)) continue
    result.push({
      source:         src,
      sessionId:      s.id,
      model:          s.dominant_model ?? 'unknown',
      cost_usd:       s.total_cost_usd ?? 0,
      last_seen_ms:   lastSeen,
      input_tokens:   s.total_input_tokens ?? 0,
      output_tokens:  s.total_output_tokens ?? 0,
      cache_read:     s.total_cache_read ?? 0,
      cache_creation: s.total_cache_creation ?? 0,
      project:        s.project_path ?? s.cwd ?? null,
    })
  }

  result.sort((a, b) => b.last_seen_ms - a.last_seen_ms)
  res.json(result.slice(0, 6))
})

// ─── GET /system-config — mapa completo del setup de Claude ──────────────────

let _systemConfigCache: unknown = null
let _systemConfigCacheTs = 0
const SYSTEM_CONFIG_TTL = 5_000

miscRouter.get('/system-config', (_req: Request, res: Response) => {
  if (_systemConfigCache && Date.now() - _systemConfigCacheTs < SYSTEM_CONFIG_TTL) {
    res.json(_systemConfigCache)
    return
  }
  try {
    const claudeDir = getClaudeDir()

    // 1. Hooks desde Claude Code settings.json
    interface RawHookEntry { matcher?: string; hooks: Array<{ type: string; command: string }> }
    let hooks: Record<string, { matcher?: string; command: string }[]> = {}
    try {
      const raw      = fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8')
      const rawHooks = JSON.parse(raw).hooks as Record<string, RawHookEntry[]> ?? {}
      for (const [event, entries] of Object.entries(rawHooks)) {
        hooks[event] = entries.flatMap(e =>
          (e.hooks ?? []).map(h => ({ matcher: e.matcher, command: h.command }))
        )
      }
    } catch {}

    // Helper para extraer descripción del frontmatter
    const getDescription = (content: string) => content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''

    // Helper compartido — escanea archivos .md directos o anidados en subdirectorios
    const scanMarkdownDir = (dir: string, excludes: string[] = [], nested?: string) => {
      const items: { name: string; description: string; lines: number }[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        let filePath: string
        let itemName: string

        if (nested) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          filePath = path.join(dir, entry.name, nested)
          itemName = entry.name
        } else {
          if (!entry.isFile() || !entry.name.endsWith('.md') || excludes.includes(entry.name)) continue
          filePath = path.join(dir, entry.name)
          itemName = entry.name.replace('.md', '')
        }

        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.split('\n').length
          items.push({ name: itemName, description: getDescription(content), lines })
        } catch {
          // Ignorar archivos no encontrados o no legibles
        }
      }
      return items
    }

    // 2. Agentes desde Claude Code agents/
    let agents: { name: string; description: string; lines: number }[] = []
    try { agents = scanMarkdownDir(path.join(claudeDir, 'agents'), ['CLAUDE.md', 'ORCHESTRATOR.md', 'AGENTS.md']) } catch {}

    // 2b. Workflows desde Claude Code agents/workflows/
    let workflows: { name: string; description: string; lines: number }[] = []
    try { workflows = scanMarkdownDir(path.join(claudeDir, 'agents', 'workflows')) } catch {}

    // 3. Archivos de contexto relevantes
    const engramSlugCtx  = getHomeSlug()
    const contextPaths = [
      { key: 'CLAUDE.md global',  filePath: path.join(claudeDir, 'CLAUDE.md') },
      { key: 'MEMORY.md',         filePath: path.join(claudeDir, 'projects', engramSlugCtx, 'memory', 'MEMORY.md') },
      { key: 'settings.json',     filePath: path.join(claudeDir, 'settings.json') },
      { key: 'config claudestat',filePath: path.join(getClaudestatDir(), 'config.json') },
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

    // 3b. Skills: commands/ (skills nativos de Claude Code) + skills/ (skills.sh)
    let skills: { name: string; description: string; lines: number }[] = []
    try { skills = scanMarkdownDir(path.join(claudeDir, 'commands')) } catch {}
    try { skills = [...skills, ...scanMarkdownDir(path.join(claudeDir, 'skills'), [], 'SKILL.md')] } catch {}

    // 4. Archivos de memoria Engram
    let memoryFiles: string[] = []
    let memoryMdLines = 0
    try {
      const memDir = path.join(claudeDir, 'projects', engramSlugCtx, 'memory')
      memoryFiles  = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort()
      try {
        const content = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf-8')
        memoryMdLines = content.split('\n').length
      } catch {}
    } catch {}

    // 5. Distribución de modos (últimos 7 días)
    const modeDistribution = dbOps.getModeDistribution(7)

    // 6. Config de claudestat
    const claudestatConfig = readConfig()

    // ─── 7. OpenCode data ────────────────────────────────────────────────────────
    const opencodeDir = getOpencodeDir()
    let opencodeConfig: Record<string, unknown> | null = null
    try {
      opencodeConfig = JSON.parse(fs.readFileSync(path.join(opencodeDir, 'opencode.json'), 'utf-8'))
    } catch {}

    let opencodeAgentsMd: { lines: number; sizeKb: number } | null = null
    try {
      const p = path.join(opencodeDir, 'AGENTS.md')
      const content = fs.readFileSync(p, 'utf-8')
      opencodeAgentsMd = { lines: content.split('\n').length, sizeKb: Math.round(Buffer.byteLength(content, 'utf-8') / 1024 * 10) / 10 }
    } catch {}

    let opencodeSkills: { name: string; description: string; lines: number }[] = []
    try {
      const skillsDir = path.join(opencodeDir, 'skills')
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
          try {
            const content = fs.readFileSync(skillMd, 'utf-8')
            const lines = content.split('\n').length
            const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''
            opencodeSkills.push({ name: entry.name, description, lines })
          } catch {}
        }
      }
    } catch {}

    let opencodeAgents: string[] = []
    try {
      const agentsDir = path.join(opencodeDir, 'agents')
      opencodeAgents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))
    } catch {}

    let opencodeProjects: number = 0
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(opencodeDir, 'projects.json'), 'utf-8'))
      opencodeProjects = Object.keys(raw.projects ?? {}).length
    } catch {}

    let opencodeCommands: string[] = []
    try {
      const cmdsDir = path.join(opencodeDir, 'commands')
      opencodeCommands = fs.readdirSync(cmdsDir).filter(f => f.endsWith('.md'))
    } catch {}

    const opencodePlugins: string[] = []
    try {
      const pluginsDir = path.join(opencodeDir, 'plugins')
      opencodePlugins.push(...fs.readdirSync(pluginsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js')))
    } catch {}

    // ─── 8. Orchestration framework data ─────────────────────────────────────────
    const aiCollabDir = path.join(os.homedir(), '.ai-collab')
    let orchScripts: { name: string; size: number; executable: boolean }[] = []
    try {
      const scriptsDir = path.join(aiCollabDir, 'scripts')
      for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.sh')) {
          const fp = path.join(scriptsDir, entry.name)
          const stat = fs.statSync(fp)
          orchScripts.push({ name: entry.name, size: stat.size, executable: (stat.mode & 0o111) !== 0 })
        }
      }
    } catch {}

    let orchPrompts: { name: string; lines: number }[] = []
    try {
      const promptsDir = path.join(aiCollabDir, 'prompts')
      for (const entry of fs.readdirSync(promptsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = fs.readFileSync(path.join(promptsDir, entry.name), 'utf-8')
          orchPrompts.push({ name: entry.name, lines: content.split('\n').length })
        }
      }
    } catch {}

    let orchSkillLines: number | null = null
    try {
      const skillPath = path.join(aiCollabDir, 'skills', 'cc-orchestrator', 'SKILL.md')
      orchSkillLines = fs.readFileSync(skillPath, 'utf-8').split('\n').length
    } catch {}

    let statusJsonValid = false
    try {
      const statusPath = path.join(aiCollabDir, 'STATUS.json')
      JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
      statusJsonValid = true
    } catch {}

    _systemConfigCache = {
      hooks, agents, workflows, skills, contextFiles, memoryFiles, memoryMdLines,
      modeDistribution, claudestatConfig,
      dbStats: dbOps.getDbStats(),
      opencode: {
        config: opencodeConfig,
        agentsMd: opencodeAgentsMd,
        skills: opencodeSkills,
        agents: opencodeAgents,
        projects: opencodeProjects,
        commands: opencodeCommands,
        plugins: opencodePlugins,
      },
      orchestration: {
        scripts: orchScripts,
        prompts: orchPrompts,
        skill_lines: orchSkillLines,
        status_json_valid: statusJsonValid,
      },
    }
    _systemConfigCacheTs = Date.now()
    res.json(_systemConfigCache)
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo config del sistema' })
  }
})

// ─── GET /config — leer configuración ────────────────────────────────────────

miscRouter.get('/config', (_req: Request, res: Response) => {
  res.json(readConfig())
})

// ─── PUT /config — guardar configuración ─────────────────────────────────────

miscRouter.put('/config', (req: Request, res: Response) => {
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

// ─── GET /cost-projection — linear regression cost projection ───────────────

miscRouter.get('/cost-projection', (_req: Request, res: Response) => {
  res.json(computeProjection(90))
})

// ─── GET /coordination/status — detección automática de herramienta activa ───

miscRouter.get('/coordination/status', (req: Request, res: Response) => {
  const project = req.query.project as string | undefined
  const tool    = (req.query.tool as string | undefined) ?? 'unknown'
  if (!project) { res.status(400).json({ error: 'project is required' }); return }

  const active = dbOps.getActiveToolsInProject(project, tool)
  res.json({
    other_tool_active: active.length > 0,
    tools:             active.map(r => r.source),
    since:             active.length > 0 ? Math.min(...active.map(r => r.last_event_at)) : null,
  })
})

// ─── GET /tool-status — estado de cada tool (claude-code, opencode) ──────────

const AI_COLLAB_STATUS = path.join(process.env.HOME ?? '/tmp', '.ai-collab', 'STATUS.json')

miscRouter.get('/tool-status', (_req: Request, res: Response) => {
  try {
    const raw = fs.readFileSync(AI_COLLAB_STATUS, 'utf-8')
    res.json(JSON.parse(raw))
  } catch {
    res.json({
      'claude-code': { status: 'unknown', last_task: null, finished_at: null, session_id: null, waiting_for: null },
      'opencode':    { status: 'unknown', last_task: null, finished_at: null, session_id: null, waiting_for: null },
    })
  }
})

// ─── POST /tool-status — actualizar estado de un tool ────────────────────────

miscRouter.post('/tool-status', (req: Request, res: Response) => {
  const { tool, status, last_task, session_id, waiting_for } = req.body as {
    tool: string; status: 'idle' | 'working'
    last_task?: string; session_id?: string; waiting_for?: string | null
  }
  if (!tool || !status) { res.status(400).json({ error: 'tool and status are required' }); return }

  let current: Record<string, unknown> = {}
  try { current = JSON.parse(fs.readFileSync(AI_COLLAB_STATUS, 'utf-8')) } catch {}

  const finished_at = status === 'idle' ? Date.now() : null
  current[tool] = { status, last_task: last_task ?? null, finished_at, session_id: session_id ?? null, waiting_for: waiting_for ?? null }

  try {
    fs.mkdirSync(path.dirname(AI_COLLAB_STATUS), { recursive: true })
    fs.writeFileSync(AI_COLLAB_STATUS, JSON.stringify(current, null, 2), 'utf-8')
  } catch (e) {
    res.status(500).json({ error: String(e) }); return
  }

  broadcast({ type: 'tool_status_changed', payload: { tool, status, last_task: last_task ?? null, finished_at, session_id: session_id ?? null, waiting_for: waiting_for ?? null } })
  res.json({ ok: true })
})

// ─── GET /api/blocks — 5-hour billing block history ──────────────────────────

miscRouter.get('/api/blocks', (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10) || 20))
  res.json({ blocks: dbOps.getBillingBlocks(limit) })
})

// ─── GET /api/activity — 52-week daily activity heatmap data ─────────────────

miscRouter.get('/api/activity', (req: Request, res: Response) => {
  const days = Math.min(730, Math.max(1, parseInt(req.query.days as string || '365', 10) || 365))
  res.json({ activity: dbOps.getDailyActivity(days) })
})

// ─── GET /api/logs — últimos N líneas del daemon log ──────────────────────────

miscRouter.get('/api/logs', (req: Request, res: Response) => {
  const n = Math.min(parseInt(req.query.n as string, 10) || 50, 500)
  const logFile = getDaemonLogFile()

  try {
    if (!fs.existsSync(logFile)) { res.json({ lines: [] }); return }
    const content = fs.readFileSync(logFile, 'utf8')
    const lines   = content.split('\n').filter(Boolean)
    res.json({ lines: lines.slice(-n) })
  } catch {
    res.json({ lines: [] })
  }
})

