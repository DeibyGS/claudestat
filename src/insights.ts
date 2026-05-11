import { dbOps } from './db'

const WEEK_MS = 7 * 86_400_000
const META_KEY = 'last_insight_at'

export interface WeeklyInsightData {
  total_sessions: number
  total_cost: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_hit_pct: number
  total_loops: number
  avg_efficiency: number
  top_tool: string
  top_tool_cost_pct: number
  week_start: number
  week_end: number
}

export function getWeeklyInsightData(days = 7): WeeklyInsightData {
  const agg = dbOps.getWeeklyInsight(days)
  const topTools = dbOps.getTopTools(days, 'cost', 1)
  const topTool = topTools[0]
  const topToolName = topTool?.tool_name ?? 'Unknown'
  const topToolPct = agg.total_cost > 0
    ? Math.round((topTool?.total_cost_usd ?? 0) / agg.total_cost * 100)
    : 0
  const totalInputWithCache = agg.input_tokens + agg.cache_read
  const cacheHitPct = totalInputWithCache > 0
    ? Math.min(100, Math.round(agg.cache_read / totalInputWithCache * 100))
    : 0

  return {
    total_sessions: agg.total_sessions,
    total_cost: agg.total_cost,
    input_tokens: agg.input_tokens,
    output_tokens: agg.output_tokens,
    cache_read: agg.cache_read,
    cache_hit_pct: cacheHitPct,
    total_loops: agg.total_loops,
    avg_efficiency: Math.round(agg.avg_efficiency),
    top_tool: topToolName,
    top_tool_cost_pct: topToolPct,
    week_start: agg.week_start,
    week_end: agg.week_end ?? agg.week_start,
  }
}

export function generateTip(d: WeeklyInsightData): string {
  const costPct = d.top_tool_cost_pct
  const tool = d.top_tool

  if (tool === 'Bash' && costPct >= 40) {
    return 'Group bash commands to reduce tool calls — each call costs context'
  }
  if (d.total_loops >= 3) {
    return `${d.total_loops} loops detected — consider using /compact earlier to prevent context thrashing`
  }
  if (d.avg_efficiency < 60) {
    return 'Low efficiency score — try smaller, focused tasks instead of long sessions'
  }
  if (d.total_sessions > 30) {
    return `${d.total_sessions} sessions this week — consider batching related work into fewer sessions`
  }
  if (d.cache_hit_pct < 10 && d.total_sessions > 5) {
    return 'Low cache hit rate — repetitive context is costing you; use CLAUDE.md for common instructions'
  }
  if (d.total_cost > 20) {
    return `$${d.total_cost.toFixed(0)} spent this week — enable quota alerts with "claudestat config --alerts true" to stay in control`
  }

  return 'Enable quota alerts with "claudestat config --alerts true" to avoid surprise limits'
}

export function shouldShowInsight(): boolean {
  const last = dbOps.getMeta(META_KEY)
  if (!last) return true
  return Date.now() - parseInt(last, 10) >= WEEK_MS
}

export function markInsightShown(): void {
  dbOps.setMeta(META_KEY, Date.now().toString())
}

export function renderWeeklyInsight(d: WeeklyInsightData): string {
  const fmtTok = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`
    return n.toString()
  }

  const fmtCost = (n: number): string => `$${n.toFixed(2)}`
  const fmtDate = (ts: number): string => {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const R = '\x1b[0m'
  const B = '\x1b[1m'
  const D = '\x1b[2m'
  const C = '\x1b[36m'

  const lines: string[] = []
  lines.push(`\n${B}📊 claudestat weekly insight${R} ${D}(${fmtDate(d.week_start)} – ${fmtDate(d.week_end)})${R}`)
  lines.push(`${'─'.repeat(60)}`)

  lines.push(
    `   Sessions: ${d.total_sessions}  ·  Cost: ${fmtCost(d.total_cost)}  ·  Loops: ${d.total_loops}`
  )

  lines.push(
    `   Top tool: ${d.top_tool} (${d.top_tool_cost_pct}% of cost)  ·  Efficiency: ${d.avg_efficiency}/100`
  )

  const cacheLabel = d.total_sessions > 0
    ? `  ·  Cache hit: ${d.cache_hit_pct}%`
    : ''

  const tokLabel = d.input_tokens + d.output_tokens > 0
    ? `  ·  Tokens: ${fmtTok(d.input_tokens)}+${fmtTok(d.output_tokens)}`
    : ''

  if (cacheLabel || tokLabel) {
    lines.push(`  ${D}${tokLabel}${cacheLabel}${R}`)
  }

  lines.push(`${'─'.repeat(60)}`)
  lines.push(`   ${C}⚡${R} Tip: ${generateTip(d)}`)
  lines.push('')

  return lines.join('\n')
}
