// ─── GET /history — sesiones agrupadas por día ────────────────────────────────

import path from 'path'
import { Router, type Request, type Response } from 'express'
import { dbOps }             from '../db'
import { getCachedGitInfo }  from '../cache/projects-cache'

export const historyRouter = Router()

// Umbrales para fusionar sesiones consecutivas
// - Mismo proyecto (project_path definido): 10 min
// - Misma fuente pero sin proyecto (CC/OC sin project_path): 5 min (más conservador)
// - Span máximo para un grupo fusionado: 12h (evita cadenas infinitas en null-project)
const MERGE_GAP_MS        = 10 * 60 * 1000
const MERGE_GAP_SOURCE_MS = 5  * 60 * 1000
const MAX_MERGE_SPAN_MS   = 12 * 60 * 60 * 1000

interface SessionEntry {
  id:             string
  project_path:   string | null
  project_name:   string | null
  started_at:     number
  last_event_at:  number
  duration_ms:    number
  total_cost_usd: number
  total_tokens:   number
  efficiency_score: number
  loops_detected: number
  done_count:     number
  top_tools:      string[]
  mode:           string
  source:         string
  ai_summary:     string | null
  is_sub_agent:   boolean
  git_branch:     string | null
  git_dirty:      boolean
  git_ahead:      number
  git_behind:     number
  merged_count:   number
}

function buildSessionEntry(s: any, gitInfo: ReturnType<typeof getCachedGitInfo>): SessionEntry {
  const hasAgent = (s.agent_count ?? 0) > 0
  const hasSkill = (s.skill_count  ?? 0) > 0
  const isSubAgent = s.parent_session_id != null
  const mode = isSubAgent ? 'sub-agente'
    : hasAgent && hasSkill ? 'agentes+skills'
    : hasAgent ? 'agentes' : hasSkill ? 'skills' : 'directo'

  return {
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
    source:       s.source ?? 'claude-code',
    ai_summary:   (s as any).ai_summary ?? null,
    is_sub_agent: isSubAgent,
    git_branch:   gitInfo?.branch       ?? null,
    git_dirty:    gitInfo?.dirty        ?? false,
    git_ahead:    gitInfo?.ahead        ?? 0,
    git_behind:   gitInfo?.behind       ?? 0,
    merged_count: 1,
  }
}

// Fusiona sesiones consecutivas del mismo proyecto con gaps menores a MERGE_GAP_MS
// Soporta solapamiento temporal (sesiones que ocurren en paralelo).
// Usa currentProject y currentSource como tracking dinámico, NO comparando contra
// current[0] — eso causaba cadenas infinitas cuando la primera sesión tenía null project.
function mergeSessionGroups(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) return []

  const sorted = [...entries].sort((a, b) => a.started_at - b.started_at)
  const groups: SessionEntry[][] = []
  let current: SessionEntry[] = [sorted[0]]
  let currentEnd = sorted[0].last_event_at ?? sorted[0].started_at
  let currentProject = sorted[0].project_path
  let currentSource = sorted[0].source

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]
    const gap = curr.started_at - currentEnd

    let canMerge = false
    let threshold = 0

    if (currentProject && curr.project_path) {
      canMerge  = currentProject === curr.project_path
      threshold = MERGE_GAP_MS
    } else if (currentProject && !curr.project_path) {
      canMerge  = true  // null-project sitúa en grupo de proyecto conocido
      threshold = MERGE_GAP_MS
    } else if (!currentProject && curr.project_path) {
      canMerge  = true  // adoptar proyecto desde null
      threshold = MERGE_GAP_MS
    } else {
      // ambos null → misma fuente
      canMerge  = currentSource === curr.source
      threshold = MERGE_GAP_SOURCE_MS
    }

    if ((gap < 0 || gap < threshold) && canMerge) {
      const candidateSpan = (curr.last_event_at ?? curr.started_at) - current[0].started_at
      if (candidateSpan > MAX_MERGE_SPAN_MS && current.length > 0) {
        groups.push(current)
        current = [curr]
        currentEnd       = curr.last_event_at ?? curr.started_at
        currentProject   = curr.project_path
        currentSource    = curr.source
        continue
      }
      current.push(curr)
      if (!currentProject && curr.project_path) currentProject = curr.project_path
      if (curr.last_event_at && curr.last_event_at > currentEnd) currentEnd = curr.last_event_at
    } else {
      groups.push(current)
      current = [curr]
      currentEnd       = curr.last_event_at ?? curr.started_at
      currentProject   = curr.project_path
      currentSource    = curr.source
    }
  }
  groups.push(current)

  return groups.map(group => {
    if (group.length === 1) return group[0]

    const first = group[0]
    const last  = group[group.length - 1]

    // Top tools: unir y contar frecuencias
    const toolCount = new Map<string, number>()
    for (const s of group) {
      for (const t of s.top_tools) {
        toolCount.set(t, (toolCount.get(t) ?? 0) + 1)
      }
    }
    const mergedTopTools = [...toolCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t)

    // Modo: si algún miembro usó agentes o skills, el grupo lo hereda
    const hasAgent = group.some(s => s.mode === 'agentes' || s.mode === 'agentes+skills')
    const hasSkill = group.some(s => s.mode === 'skills'   || s.mode === 'agentes+skills')
    const mode = hasAgent && hasSkill ? 'agentes+skills'
      : hasAgent ? 'agentes' : hasSkill ? 'skills' : 'directo'

    // Eficiencia: promedio ponderado por duración
    const totalDuration = group.reduce((sum, s) => sum + s.duration_ms, 0)
    const efficiency = totalDuration > 0
      ? Math.round(group.reduce((sum, s) => sum + s.efficiency_score * s.duration_ms, 0) / totalDuration)
      : first.efficiency_score

    // Proyecto: el más frecuente en el grupo
    const projCount = new Map<string | null, number>()
    for (const s of group) {
      const key = s.project_path
      projCount.set(key, (projCount.get(key) ?? 0) + 1)
    }
    const dominantProj = [...projCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const dominantName = dominantProj ? path.basename(dominantProj) : null

    // Resumen: el más largo (suele ser el más informativo)
    const bestSummary = group
      .filter(s => s.ai_summary)
      .sort((a, b) => (b.ai_summary ?? '').length - (a.ai_summary ?? '').length)
      [0]?.ai_summary ?? null

    // Fuente: si hay mezcla, etiquetar como 'opencode & claude-code'
    const sources = new Set(group.map(s => s.source))
    const mergedSource = sources.size === 1 ? first.source : 'opencode & claude-code'

    return {
      id:             first.id,
      project_path:   dominantProj,
      project_name:   dominantName,
      started_at:     first.started_at,
      last_event_at:  last.last_event_at ?? last.started_at,
      duration_ms:    (last.last_event_at ?? last.started_at) - first.started_at,
      total_cost_usd: group.reduce((sum, s) => sum + s.total_cost_usd, 0),
      total_tokens:   group.reduce((sum, s) => sum + s.total_tokens,   0),
      efficiency_score: efficiency,
      loops_detected:   group.reduce((sum, s) => sum + s.loops_detected, 0),
      done_count:       group.reduce((sum, s) => sum + s.done_count,     0),
      top_tools:      mergedTopTools,
      mode,
      source:         mergedSource,
      ai_summary:     bestSummary,
      is_sub_agent:   false,
      git_branch:     first.git_branch,
      git_dirty:      first.git_dirty,
      git_ahead:      first.git_ahead,
      git_behind:     first.git_behind,
      merged_count:   group.length,
    }
  })
}

historyRouter.get('/history', (req: Request, res: Response) => {
  const periodDays = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365)
  const rows = dbOps.getRecentSessions(periodDays)

  // Construir entries individuales
  const entries: SessionEntry[] = []
  for (const s of rows) {
    const gitInfo = s.project_path ? getCachedGitInfo(s.project_path) : null
    entries.push(buildSessionEntry(s, gitInfo))
  }

  // Fusionar sesiones consecutivas del mismo proyecto
  const merged = mergeSessionGroups(entries)

  // Agrupar por fecha local (YYYY-MM-DD)
  const byDate = new Map<string, SessionEntry[]>()

  for (const s of merged) {
    const date = new Date(s.started_at).toLocaleDateString('en-CA')
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(s)
  }

  const days = [...byDate.entries()]
    .map(([date, sessions]) => ({
      date,
      sessions,
      total_cost:    sessions.reduce((sum, x) => sum + x.total_cost_usd, 0),
      total_tokens:  sessions.reduce((sum, x) => sum + x.total_tokens,   0),
      total_duration_ms: sessions.reduce((sum, x) => sum + x.duration_ms, 0),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  res.json({ days })
})
