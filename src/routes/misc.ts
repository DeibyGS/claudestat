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
import { sessionLastEvent }     from './stream'

export const miscRouter = Router()

// ─── GET /git?path=... — git info para un proyecto ────────────────────────────

miscRouter.get('/git', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Falta parámetro path' }); return }
  res.json(getCachedGitInfo(projectPath) ?? null)
})

// ─── GET /pr?path=... — estado del PR para un proyecto ────────────────────────

miscRouter.get('/pr', (req: Request, res: Response) => {
  const projectPath = req.query.path as string | undefined
  if (!projectPath) { res.status(400).json({ error: 'Falta parámetro path' }); return }
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
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  const events = dbOps.getSessionEvents(sessionId)
  const report = analyzeSession(events, session.total_cost_usd ?? 0)
  res.json({ sessionId, ...report })
})

// ─── GET /quota — datos de cuota y burn rate ──────────────────────────────────

miscRouter.get('/quota', (_req: Request, res: Response) => {
  try {
    const cfg  = readConfig()
    const data = computeQuota(cfg.plan ?? undefined)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Error calculando quota' })
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
      ? `Cuota 5h al ${data.cyclePct}% (límite: ${cfg.killSwitchThreshold}%). Reset en ${formatMs(data.cycleResetMs)}.`
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

// ─── GET /prompts — mensajes del usuario para una sesión ─────────────────────

miscRouter.get('/prompts', (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string | undefined
  if (!sessionId) return res.status(400).json({ error: 'session_id required' })
  res.json({ prompts: getSessionPrompts(sessionId) })
})

// ─── GET /hidden-cost — coste oculto en loops (últimos 7 días) ───────────────

miscRouter.get('/hidden-cost', (_req: Request, res: Response) => {
  res.json(dbOps.getHiddenCostStats(7))
})

// ─── GET /claude-stats — actividad de ~/.claude/stats-cache.json ─────────────

miscRouter.get('/claude-stats', (_req: Request, res: Response) => {
  res.json(readClaudeStats())
})

// ─── GET /system-config — mapa completo del setup de Claude ──────────────────

let _systemConfigCache: unknown = null
let _systemConfigCacheTs = 0
const SYSTEM_CONFIG_TTL = 30_000

miscRouter.get('/system-config', (_req: Request, res: Response) => {
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

    // Helper para extraer descripción del frontmatter
    const getDescription = (content: string) => content.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''

    // Helper compartido — escanea archivos .md directos o anidados en subdirectorios
    const scanMarkdownDir = (dir: string, excludes: string[] = [], nested?: string) => {
      const items: { name: string; description: string; lines: number }[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        let filePath: string
        let itemName: string

        if (nested) {
          // Modo anidado: busca nested (ej. SKILL.md) dentro de carpetas/symlinks
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          filePath = path.join(dir, entry.name, nested)
          itemName = entry.name
        } else {
          // Modo directo: archivos .md
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

    // 3b. Skills: ~/.claude/commands/ (skills nativos de Claude Code) + ~/.claude/skills/ (skills.sh)
    let skills: { name: string; description: string; lines: number }[] = []
    try { skills = scanMarkdownDir(path.join(home, '.claude', 'commands')) } catch {}
    try { skills = [...skills, ...scanMarkdownDir(path.join(home, '.claude', 'skills'), [], 'SKILL.md')] } catch {}

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

