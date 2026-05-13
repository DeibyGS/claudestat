import path from 'path'
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

export interface UsageInsightsData {
  days:                 number
  total_sessions:       number
  total_cost:           number
  avg_cost_per_session: number
  cache_savings_usd:    number
  cache_hit_pct:        number
  output_input_ratio:   number
  ratio_label:          string
  avg_efficiency:       number
  efficiency_delta:     number   // -999 = no prev data
  total_loops:          number
  project_costs:        { project: string; session_count: number; total_cost: number }[]
  hour_ranges:          { emoji: string; from: string; to: string; count: number }[]
}

export function getUsageInsights(days = 7): UsageInsightsData {
  const agg      = dbOps.getWeeklyInsight(days)
  const aggTotal = dbOps.getWeeklyInsight(days * 2)

  const prevSessions = aggTotal.total_sessions - agg.total_sessions
  const effDelta = prevSessions > 2
    ? Math.round(
        agg.avg_efficiency -
        (aggTotal.avg_efficiency * aggTotal.total_sessions - agg.avg_efficiency * agg.total_sessions) / prevSessions
      )
    : -999

  const totalInputWithCache = agg.input_tokens + agg.cache_read
  const cacheHitPct = totalInputWithCache > 0
    ? Math.min(100, Math.round(agg.cache_read / totalInputWithCache * 100))
    : 0

  const outputInputRatio = agg.input_tokens > 0
    ? parseFloat((agg.output_tokens / agg.input_tokens).toFixed(1))
    : 0

  const ratioLabel = outputInputRatio > 10 ? 'cache-heavy workload'
    : outputInputRatio > 5  ? 'generation-heavy'
    : outputInputRatio > 2  ? 'balanced'
    : 'reading-heavy'

  const CACHE_READ_PRICE: Record<string, number> = {
    'claude-haiku-4-5-20251001': 0.30 / 1_000_000,
    'claude-sonnet-4-6':          2.70 / 1_000_000,
    'claude-opus-4-6':            3.00 / 1_000_000,
  }
  const DEFAULT_CACHE_PRICE = 2.70 / 1_000_000

  const cacheByModel = dbOps.getCacheReadByModel(days)
  const cacheSavings = cacheByModel.reduce((total, row) => {
    const price = CACHE_READ_PRICE[row.model] ?? DEFAULT_CACHE_PRICE
    return total + row.cache_read * price
  }, 0)

  return {
    days,
    total_sessions:       agg.total_sessions,
    total_cost:           agg.total_cost,
    avg_cost_per_session: agg.total_sessions > 0 ? agg.total_cost / agg.total_sessions : 0,
    cache_savings_usd:    cacheSavings,
    cache_hit_pct:        cacheHitPct,
    output_input_ratio:   outputInputRatio,
    ratio_label:          ratioLabel,
    avg_efficiency:       Math.round(agg.avg_efficiency),
    efficiency_delta:     effDelta,
    total_loops:          agg.total_loops,
    project_costs:        dbOps.getProjectCosts(days),
    hour_ranges:          (() => {
      const hours = dbOps.getHourlyDistribution(days)
      const dawn  = hours.filter(h => h.hour >= 0  && h.hour <= 5).reduce((s, h) => s + h.session_count, 0)
      const morn  = hours.filter(h => h.hour >= 6  && h.hour <= 11).reduce((s, h) => s + h.session_count, 0)
      const after = hours.filter(h => h.hour >= 12 && h.hour <= 17).reduce((s, h) => s + h.session_count, 0)
      const night = hours.filter(h => h.hour >= 18 && h.hour <= 23).reduce((s, h) => s + h.session_count, 0)
      return [
        { emoji: '🌙', from: '00:00', to: '05:59', count: dawn  },
        { emoji: '🌅', from: '06:00', to: '11:59', count: morn  },
        { emoji: '☀️', from: '12:00', to: '17:59', count: after },
        { emoji: '🌆', from: '18:00', to: '23:59', count: night },
      ].filter(r => r.count > 0)
    })(),
  }
}

export function renderInsights(d: UsageInsightsData): string {
  const R = '\x1b[0m'
  const B = '\x1b[1m'
  const D = '\x1b[2m'
  const G = '\x1b[32m'
  const Y = '\x1b[33m'
  const C = '\x1b[36m'
  const M = '\x1b[35m'

  const bar = (pct: number, width = 20): string =>
    '█'.repeat(Math.round(pct / 100 * width)) + '░'.repeat(width - Math.round(pct / 100 * width))

  const fmtDollar = (n: number) => n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`

  const lines: string[] = []
  lines.push(`\n${B}💡 claudestat insights${R}  ${D}last ${d.days} days${R}`)
  lines.push('━'.repeat(44))

  // Cost summary
  lines.push(`\n  💰  ${B}${fmtDollar(d.avg_cost_per_session)}/session${R}  ·  ${d.total_sessions} sessions  ·  ${fmtDollar(d.total_cost)} total`)

  // Top projects
  if (d.project_costs.length > 0) {
    lines.push(`\n  🗂  Top projects`)
    const topTotal = d.project_costs.reduce((s, p) => s + p.total_cost, 0)
    const shown    = d.project_costs.slice(0, 4)
    const otherCost = d.total_cost - shown.reduce((s, p) => s + p.total_cost, 0)
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i]
      const pct  = topTotal > 0 ? Math.round(p.total_cost / topTotal * 100) : 0
      const name = path.basename(p.project).slice(0, 14).padEnd(14)
      lines.push(`     ${C}${name}${R}  ${bar(pct)}  ${fmtDollar(p.total_cost)}  ${D}${pct}%${R}`)
      if (i < shown.length - 1 || (otherCost > 0.01 && d.project_costs.length > 4)) lines.push('')
    }
    if (otherCost > 0.01 && d.project_costs.length > 4) {
      const pct = topTotal > 0 ? Math.round(otherCost / topTotal * 100) : 0
      lines.push(`     ${'other'.padEnd(14)}  ${bar(pct)}  ${fmtDollar(otherCost)}  ${D}${pct}%${R}`)
    }
  }

  // Cache savings
  const savingsLabel = d.cache_savings_usd >= 0.01
    ? `${G}~${fmtDollar(d.cache_savings_usd)}${R} saved`
    : 'no savings yet'
  lines.push(`\n  ⚡  Cache ${savingsLabel}  ·  ${d.cache_hit_pct}% hit rate`)

  // Output/input ratio
  lines.push(`\n  📊  ${B}${d.output_input_ratio}×${R} output/input  ·  ${D}${d.ratio_label}${R}`)

  // Efficiency trend
  let effTrend = ''
  if (d.efficiency_delta !== -999) {
    const arrow = d.efficiency_delta > 0
      ? `${G}↑ +${d.efficiency_delta}${R}`
      : d.efficiency_delta < 0 ? `${Y}↓ ${d.efficiency_delta}${R}` : '→ same'
    effTrend = `  ${arrow} vs prev period`
  }
  const loopLabel = d.total_loops > 0 ? `  ·  ${Y}${d.total_loops} loops${R}` : ''
  lines.push(`\n  📈  Efficiency  ${B}${d.avg_efficiency}/100${R}${effTrend}${loopLabel}`)

  // Activity by time range
  if (d.hour_ranges.length > 0) {
    lines.push(`\n  ⏰  Activity by time of day`)
    const maxCount = Math.max(...d.hour_ranges.map(r => r.count))
    for (let i = 0; i < d.hour_ranges.length; i++) {
      const r = d.hour_ranges[i]
      const pct = maxCount > 0 ? Math.round(r.count / maxCount * 100) : 0
      lines.push(`     ${r.emoji}  ${D}${r.from}–${r.to}${R}  ${M}${bar(pct)}${R}  ${D}${r.count} sessions${R}`)
      if (i < d.hour_ranges.length - 1) lines.push('')
    }
  }

  // Model breakdown
  const models = dbOps.getModelBreakdown(d.days)
  const modelsWithCost = models.filter(m => m.total_cost > 0)
  if (modelsWithCost.length >= 2) {
    lines.push(`\n  🤖  Models`)
    for (let i = 0; i < modelsWithCost.length; i++) {
      const m = modelsWithCost[i]
      const pct = d.total_cost > 0 ? Math.round(m.total_cost / d.total_cost * 100) : 0
      const rawName = (m.model ?? 'unknown').replace(/^<|>$/g, '')
      const name = rawName.slice(0, 28).padEnd(28)
      lines.push(`     ${C}${name}${R}  ${bar(pct)}  ${fmtDollar(m.total_cost)}  ${D}${pct}% · ${m.session_count} sessions${R}`)
      if (i < modelsWithCost.length - 1) lines.push('')
    }
  }

  lines.push('\n' + '━'.repeat(44) + '\n')
  return lines.join('\n')
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

  const R = '\x1b[0m'
  const B = '\x1b[1m'
  const D = '\x1b[2m'
  const G = '\x1b[32m'
  const Y = '\x1b[33m'
  const C = '\x1b[36m'

  const bar = (pct: number, width = 20): string => {
    const filled = Math.round(Math.min(pct, 100) / 100 * width)
    const color = pct >= 90 ? '\x1b[31m' : pct >= 70 ? '\x1b[33m' : '\x1b[32m'
    return `${color}${'█'.repeat(filled)}${R}${D}${'░'.repeat(width - filled)}${R}`
  }

  const fmtDate = (ts: number): string => {
    const dt = new Date(ts)
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const lines: string[] = []
  lines.push(`\n${B}📊 claudestat weekly${R}  ${D}${fmtDate(d.week_start)} – ${fmtDate(d.week_end)}${R}`)
  lines.push('━'.repeat(44))
  lines.push('')
  lines.push(`  💰  ${B}$${d.total_cost.toFixed(2)}${R} total  ·  ${B}${d.total_sessions}${R} sessions  ·  ${B}${d.total_loops}${R} loops`)
  lines.push('')
  lines.push(`  🔧  Top tool    ${B}${d.top_tool}${R}  ${D}${d.top_tool_cost_pct}% of cost${R}`)
  lines.push('')
  lines.push(`  📈  Efficiency    ${bar(d.avg_efficiency)}  ${B}${d.avg_efficiency}/100${R}`)
  lines.push('')
  lines.push(`  💾  Cache hit     ${bar(d.cache_hit_pct)}  ${B}${d.cache_hit_pct}%${R}`)
  lines.push('')
  lines.push(`  📦  Tokens  ${D}${fmtTok(d.input_tokens)} in + ${fmtTok(d.output_tokens)} out${R}`)
  lines.push('')
  lines.push(`  ${C}⚡  Tip:${R} ${generateTip(d)}`)
  lines.push('')
  lines.push('━'.repeat(44))
  lines.push('')

  return lines.join('\n')
}
