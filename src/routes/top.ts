import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'

export const topRouter = Router()

topRouter.get('/api/top-other', (req: Request, res: Response) => {
  const by     = (req.query.by as string) ?? 'cost'
  const days   = Math.min(parseInt(req.query.days as string, 10) || 30, 365)
  const source = (req.query.source as string) ?? 'all'

  if (!['cost', 'count', 'duration'].includes(by)) { res.status(400).json({ error: 'Invalid "by"' }); return }

  const all       = dbOps.getTopTools(days, by as 'cost' | 'count' | 'duration', 50, source as 'all' | 'claude-code' | 'opencode')
  const real      = all.filter(t => t.tool_name !== 'Other')
  const others    = real.slice(10)
  const totalCost = all.reduce((s, t) => s + t.total_cost_usd, 0)
  const totalCount = real.reduce((s, t) => s + t.count, 0)

  res.json({
    by, days, source,
    tools: others.map(t => ({
      tool:             t.tool_name,
      source:           t.source,
      count:            t.count,
      totalDurationMs:  t.total_duration_ms,
      estimatedCostUsd: t.total_cost_usd,
      pctCost:          totalCost > 0 ? Math.round(t.total_cost_usd / totalCost * 100) : 0,
      pctCount:         totalCount > 0 ? Math.round(t.count / totalCount * 100) : 0,
    })),
  })
})

topRouter.get('/api/top', (req: Request, res: Response) => {
  const by     = (req.query.by as string) ?? 'cost'
  const limit  = Math.min(parseInt(req.query.limit as string, 10) || 10, 50)
  const days   = Math.min(parseInt(req.query.days as string, 10) || 30, 365)
  const source = (req.query.source as string) ?? 'all'

  if (!['cost', 'count', 'duration'].includes(by)) {
    res.status(400).json({ error: 'Invalid "by" parameter. Use: cost, count, duration' })
    return
  }
  if (!['all', 'claude-code', 'opencode'].includes(source)) {
    res.status(400).json({ error: 'Invalid "source" parameter. Use: all, claude-code, opencode' })
    return
  }

  const tools = dbOps.getTopTools(days, by as 'cost' | 'count' | 'duration', limit, source as 'all' | 'claude-code' | 'opencode')
  const totalCost  = tools.reduce((s, t) => s + t.total_cost_usd, 0)
  const totalCount = tools.filter(t => t.tool_name !== 'Other').reduce((s, t) => s + t.count, 0)

  res.json({
    by,
    days,
    source,
    tools: tools.map(t => ({
      tool:             t.tool_name,
      source:           t.source,
      count:            t.count,
      totalDurationMs:  t.total_duration_ms,
      estimatedCostUsd: t.total_cost_usd,
      pctCost:          totalCost > 0 ? Math.round(t.total_cost_usd / totalCost * 100) : 0,
      pctCount:         totalCount > 0 ? Math.round(t.count / totalCount * 100) : 0,
    })),
  })
})

topRouter.get('/api/top-sparklines', (req: Request, res: Response) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days as string, 10) || 7, 90))
  const tools = req.query.tools as string
  if (!tools) { res.status(400).json({ error: 'tools required' }); return }
  const toolList = tools.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20)
  const result = dbOps.getToolSparklines(toolList, days)
  res.json({ sparklines: result })
})
