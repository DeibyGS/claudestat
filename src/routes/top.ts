import { Router, type Request, type Response } from 'express'
import { dbOps } from '../db'

export const topRouter = Router()

topRouter.get('/api/top', (req: Request, res: Response) => {
  const by    = (req.query.by as string) ?? 'cost'
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50)
  const days  = Math.min(parseInt(req.query.days as string, 10) || 30, 365)

  if (!['cost', 'count', 'duration'].includes(by)) {
    res.status(400).json({ error: 'Invalid "by" parameter. Use: cost, count, duration' })
    return
  }

  const tools = dbOps.getTopTools(days, by as 'cost' | 'count' | 'duration', limit)
  const totalCost = tools.reduce((s, t) => s + t.total_cost_usd, 0)
  const totalCount = tools.filter(t => t.tool_name !== 'Other').reduce((s, t) => s + t.count, 0)

  res.json({
    by,
    days,
    tools: tools.map(t => ({
      tool:           t.tool_name,
      count:          t.count,
      totalDurationMs: t.total_duration_ms,
      estimatedCostUsd: t.total_cost_usd,
      pctCost:        totalCost > 0 ? Math.round(t.total_cost_usd / totalCost * 100) : 0,
      pctCount:       totalCount > 0 ? Math.round(t.count / totalCount * 100) : 0,
    })),
  })
})
