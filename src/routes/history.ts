// ─── GET /history — sesiones agrupadas por día ────────────────────────────────

import path from 'path'
import { Router, type Request, type Response } from 'express'
import { dbOps }             from '../db'
import { getCachedGitInfo }  from '../cache/projects-cache'

export const historyRouter = Router()

historyRouter.get('/history', (_req: Request, res: Response) => {
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
