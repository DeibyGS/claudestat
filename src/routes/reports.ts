// ─── Rutas de reportes: /api/weekly-reports, /api/analytics, /api/quota-stats
//     + helpers del scheduler (getReportDateLabel, generateReport, getISOWeek) ──

import path from 'path'
import fs   from 'fs'
import os   from 'os'
import { Router, type Request, type Response } from 'express'
import { dbOps }                               from '../db'
import { readConfig, type ClaudestatConfig }   from '../config'

export const reportsRouter = Router()

// ─── POST /api/weekly-reports — guardar reporte generado por weekly-review.sh ─

reportsRouter.post('/api/weekly-reports', (req: Request, res: Response) => {
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

reportsRouter.get('/api/analytics', (req: Request, res: Response) => {
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

reportsRouter.post('/api/weekly-reports/generate-now', (_req: Request, res: Response) => {
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

reportsRouter.post('/api/weekly-reports/import-local', (_req: Request, res: Response) => {
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

reportsRouter.get('/api/weekly-reports', (_req: Request, res: Response) => {
  res.json(dbOps.listWeeklyReports())
})

// ─── GET /api/weekly-reports/:date — reporte completo de una fecha ────────────

reportsRouter.get('/api/weekly-reports/:date', (req: Request, res: Response) => {
  const report = dbOps.getWeeklyReportByDate(req.params.date)
  if (!report) { res.status(404).json({ error: 'not found' }); return }
  res.json(report)
})

// ─── GET /api/quota-stats — P90 de tokens y coste (últimos 30 días) ──────────

reportsRouter.get('/api/quota-stats', (_req: Request, res: Response) => {
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

// ─── Report scheduler helpers (exportados para daemon.ts) ────────────────────

/** Número de semana ISO para lógica quincenal (semanas pares = informe). */
export function getISOWeek(date: Date): number {
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
export function getReportDateLabel(now: Date, cfg: ClaudestatConfig): string | null {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (hhmm !== cfg.reportTime) return null
  if (now.getDay() !== cfg.reportDay) return null

  if (cfg.reportFrequency === 'biweekly' && getISOWeek(now) % 2 !== 0) return null
  if (cfg.reportFrequency === 'monthly'  && now.getDate() > 7)          return null

  return now.toISOString().slice(0, 10)
}

/** Genera el markdown del informe para el período dado. */
export function generateReport(dateLabel: string, cfg: ClaudestatConfig): string {
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
