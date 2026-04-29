// ─── GET /projects — listado de proyectos con stats ──────────────────────────

import path from 'path'
import fs   from 'fs'
import { Router, type Request, type Response } from 'express'
import { dbOps, type EventRow }  from '../db'
import { getProjectsCached }     from '../cache/projects-cache'
import { analyzePatterns }       from '../pattern-analyzer'

export const projectsRouter = Router()

/** Sube el árbol desde un file_path hasta encontrar HANDOFF.md → directorio del proyecto */
export function findProjectCwdForFile(filePath: string): string | undefined {
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
export function inferProjectCwd(events: EventRow[]): string | undefined {
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
export function inferActiveProjectByMajority(events: EventRow[], windowMs: number): string | undefined {
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

projectsRouter.get('/projects', (_req: Request, res: Response) => {
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
