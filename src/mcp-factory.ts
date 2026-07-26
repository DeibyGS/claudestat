import * as readline from 'readline'
import fs   from 'fs'
import path from 'path'
import { dbOps } from './db'
import { computeQuota, refreshFromApi } from './quota-tracker'
import { getWeeklyInsightData, generateTip, getUsageInsights } from './insights'
import { readConfig, getWarnLevel } from './config'
import { getPidFile } from './paths'
import { getContextWindow } from './pricing'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: object
  handler: (args: Record<string, unknown>) => Promise<string> | string
}

export interface McpServerOptions {
  tools?: ToolDefinition[]
  name?: string
  version?: string
  contextPolling?: boolean
}

export interface McpServer {
  start(): void
  stop(): void
  addTool(def: ToolDefinition): void
  removeTool(name: string): void
  readonly tools: ToolDefinition[]
}

const DAEMON_WARNING = `claudestat daemon is not running — real-time monitoring is disabled.
Start it with: claudestat start

Data shown below is from the last recorded session.
---`

const PROTOCOL_VERSION = '2025-03-26'

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> }
type JsonRpcResponse = { jsonrpc: '2.0'; id?: number | string; result?: unknown; error?: { code: number; message: string } }

function fmtDollar(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '< $0.01'
  return `$${n.toFixed(2)}`
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toString()
}

function isDaemonRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(getPidFile(), 'utf8').trim(), 10)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function toolGetQuotaStatus(): string {
  const q = computeQuota()
  const resetMin = Math.ceil(q.cycleResetMs / 60_000)
  const resetLabel = resetMin >= 60
    ? `${Math.floor(resetMin / 60)}h ${resetMin % 60}m`
    : `${resetMin}m`

  const weeklyTotalHours = q.weeklyHoursSonnet + q.weeklyHoursOpus
  const weeklyLimitTotal = q.weeklyLimitSonnet + q.weeklyLimitOpus

  const planLabel = q.planSource === 'inferred'
    ? `${q.detectedPlan.toUpperCase()} plan (unverified — checking API...)`
    : `${q.detectedPlan.toUpperCase()} plan`

  const parts: string[] = [
    `Quota status — ${planLabel}`,
    ``,
    `5h cycle:    ${q.cyclePct}%  ·  ${q.cyclePrompts > q.cycleLimit ? `${q.cyclePrompts}/${q.cycleLimit} prompts (OVER LIMIT)` : `${q.cyclePrompts}/${q.cycleLimit} prompts`}  ·  resets in ${resetLabel}`,
    `Weekly:      ${weeklyTotalHours}h / ${weeklyLimitTotal}h (${q.weeklyPctAll}%)`,
  ]
  if (q.weeklyLimitOpus > 0) {
    parts.push(`   |- Sonnet  ${q.weeklyHoursSonnet}h / ${q.weeklyLimitSonnet}h`)
    parts.push(`   |- Opus    ${q.weeklyHoursOpus}h / ${q.weeklyLimitOpus}h`)
  }
  if (q.burnRateTokensPerMin > 0) {
    parts.push(`Burn rate:   ${q.burnRateTokensPerMin.toLocaleString()} tokens/min`)
  }

  const cfg = readConfig()
  if (cfg.alertsEnabled) {
    const alerts: string[] = []
    const cycleLevel  = getWarnLevel(q.cyclePct,    cfg.warnThresholds)
    const weeklyLevel = getWarnLevel(q.weeklyPctAll, cfg.weeklyWarnThresholds)

    if (cycleLevel === 'red')    alerts.push(`5h cycle at ${q.cyclePct}% — critical, limit imminent`)
    else if (cycleLevel)         alerts.push(`5h cycle at ${q.cyclePct}% — approaching limit`)

    if (weeklyLevel === 'red')   alerts.push(`Weekly at ${q.weeklyPctAll}% — critical`)
    else if (weeklyLevel)        alerts.push(`Weekly at ${q.weeklyPctAll}% — approaching weekly limit`)

    if (q.cyclePrompts > q.cycleLimit) {
      alerts.push(`Prompt count (${q.cyclePrompts}) exceeds plan limit (${q.cycleLimit}) — plan may be mis-detected`)
    }

    const reminderMins = cfg.resetReminderMins ?? 10
    if (reminderMins > 0 && resetMin <= reminderMins && resetMin > 0) {
      alerts.push(`Cycle resets in ${resetMin}m — good time to wrap up or start fresh`)
    }

    if (alerts.length > 0) {
      parts.push(``)
      parts.push(`--- ACTIVE ALERTS ---`)
      parts.push(...alerts)
    }
  }

  return parts.join('\n')
}

function toolGetCurrentSession(): string {
  const session = dbOps.getLatestSession()
  if (!session) return 'No sessions recorded yet.'

  const cost = fmtDollar(session.total_cost_usd ?? 0)
  const inp = fmtTok(session.total_input_tokens ?? 0)
  const out = fmtTok(session.total_output_tokens ?? 0)
  const cache = fmtTok(session.total_cache_read ?? 0)
  const eff = session.efficiency_score ?? 100
  const loops = session.loops_detected ?? 0
  const started = new Date(session.started_at).toISOString()
  const project = session.project_path ?? 'No project'
  const model = (session as any).dominant_model ?? 'unknown'

  return [
    `Latest session: ${session.id.slice(0, 8)}...`,
    ``,
    `Project:    ${project}`,
    `Model:      ${model}`,
    `Started:    ${started}`,
    `Cost:       ${cost}`,
    `Tokens:     ${inp} in + ${out} out  (${cache} cache read)`,
    `Efficiency: ${eff}/100`,
    `Loops:      ${loops}`,
  ].join('\n')
}

function toolGetSessionStats(days: number): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 7)))
  const insight = dbOps.getWeeklyInsight(d)
  if (!insight || insight.total_sessions === 0) return `No sessions in the last ${d} days.`

  const totalTok = insight.input_tokens + insight.output_tokens
  return [
    `Session stats — last ${d} days`,
    ``,
    `Sessions:     ${insight.total_sessions}`,
    `Cost:         ${fmtDollar(insight.total_cost)}`,
    `Tokens:       ${fmtTok(totalTok)} (${fmtTok(insight.input_tokens)} in + ${fmtTok(insight.output_tokens)} out)`,
    `Cache read:   ${fmtTok(insight.cache_read)}`,
    `Loops:        ${insight.total_loops}`,
    `Efficiency:   ${Math.round(insight.avg_efficiency)}/100 avg`,
  ].join('\n')
}

function toolGetTopTools(days: number, sortBy: string): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 30)))
  const sort = (sortBy === 'count' || sortBy === 'duration') ? sortBy : 'cost'
  const tools = dbOps.getTopTools(d, sort as 'cost' | 'count' | 'duration', 10)

  if (tools.length === 0) return `No tool usage data in the last ${d} days.`

  const lines: string[] = [
    `Top tools — last ${d} days (sorted by ${sort})`,
    '',
  ]

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    const idx = `${i + 1}.`.padEnd(4)
    const name = t.tool_name.padEnd(14)
    const cnt = `${t.count} calls`.padEnd(14)
    const dur = t.total_duration_ms > 0
      ? `${(t.total_duration_ms / 1000).toFixed(1)}s`.padEnd(10)
      : '-'.padEnd(10)
    const cost = fmtDollar(t.total_cost_usd)
    lines.push(`  ${idx}${name}${cnt}${dur}${cost}`)
  }

  return lines.join('\n')
}

function toolGetUsageInsights(days: number): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 7)))
  const i = getUsageInsights(d)

  if (i.total_sessions === 0) return `No data for the last ${d} days.`

  const bar = (pct: number, width = 20): string =>
    '\u2588'.repeat(Math.round(pct / 100 * width)) + '\u2591'.repeat(width - Math.round(pct / 100 * width))

  const lines: string[] = []
  lines.push(`Usage insights — last ${d} days`)
  lines.push('\u2501'.repeat(44))
  lines.push(``)
  lines.push(`  $ ${fmtDollar(i.avg_cost_per_session)}/session  ·  ${i.total_sessions} sessions  ·  ${fmtDollar(i.total_cost)} total`)

  if (i.project_costs.length > 0) {
    lines.push(``)
    lines.push(`  Top projects`)
    const topTotal = i.project_costs.reduce((s, p) => s + p.total_cost, 0)
    for (const p of i.project_costs.slice(0, 4)) {
      const pct  = topTotal > 0 ? Math.round(p.total_cost / topTotal * 100) : 0
      const name = (p.project.split('/').pop() ?? p.project).slice(0, 14).padEnd(14)
      lines.push(`     ${name}  ${bar(pct)}  ${fmtDollar(p.total_cost)}  ${pct}%`)
    }
  }

  lines.push(``)
  lines.push(`  Cache ~${fmtDollar(i.cache_savings_usd)} saved  ·  ${i.cache_hit_pct}% hit rate`)
  lines.push(``)
  lines.push(`  ${i.output_input_ratio}x output/input  ·  ${i.ratio_label}`)
  lines.push(``)

  const effTrend = i.efficiency_delta !== -999
    ? `  ${i.efficiency_delta > 0 ? `up +${i.efficiency_delta}` : i.efficiency_delta < 0 ? `down ${i.efficiency_delta}` : 'same'} vs prev period`
    : ''
  lines.push(`  Efficiency ${i.avg_efficiency}/100${effTrend}  ·  ${i.total_loops} loops`)

  if (i.hour_ranges.length > 0) {
    lines.push(``)
    lines.push(`  Activity by time of day`)
    const maxCount = Math.max(...i.hour_ranges.map(r => r.count))
    for (let j = 0; j < i.hour_ranges.length; j++) {
      const r = i.hour_ranges[j]
      const pct = maxCount > 0 ? Math.round(r.count / maxCount * 100) : 0
      lines.push(`     ${r.emoji}  ${r.from}-${r.to}  ${bar(pct)}  ${r.count} sessions`)
      if (j < i.hour_ranges.length - 1) lines.push('')
    }
  }

  lines.push(``)
  lines.push('\u2501'.repeat(44))
  return lines.join('\n')
}

function toolGetModelBreakdown(days: number): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 7)))
  const models = dbOps.getModelBreakdown(d)

  if (models.length === 0) return `No model data in the last ${d} days.`

  const totalCost = models.reduce((s, m) => s + m.total_cost, 0)
  const lines: string[] = [
    `Model breakdown — last ${d} days`,
    '',
  ]

  for (const m of models) {
    const pct = totalCost > 0 ? Math.round(m.total_cost / totalCost * 100) : 0
    const rawName = (m.model ?? 'unknown').replace(/^<|>$/g, '')
    const name = rawName.padEnd(30)
    const cost = fmtDollar(m.total_cost).padEnd(10)
    lines.push(`  ${name}${cost}${pct}%   ${m.session_count} sessions`)
  }

  return lines.join('\n')
}

function toolGetContextStatus(): string {
  const session = dbOps.getLatestSession()
  if (!session) return 'No sessions recorded yet.'

  const contextUsed = session.context_used ?? 0
  const dominantModel = session.dominant_model ?? ''
  const contextWindow = session.context_window ?? getContextWindow(dominantModel)
  const pct = contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0

  const bar = (p: number, width = 20): string =>
    '\u2588'.repeat(Math.round(p / 100 * width)) + '\u2591'.repeat(width - Math.round(p / 100 * width))

  const level = pct >= 90 ? 'RED' : pct >= 75 ? 'ORA' : pct >= 50 ? 'YEL' : 'GRN'

  return [
    `Context status — ${session.id.slice(0, 8)}`,
    ``,
    `  ${level}  ${pct}%  ${bar(pct)}`,
    `  Used:  ${contextUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`,
    `  Model: ${dominantModel || 'unknown'}`,
    `  Project: ${path.basename(session.project_path ?? '') || '-'}`,
    ...(pct >= 90 ? ['', 'Context near saturation — consider starting a new session'] : []),
    ...(pct >= 75 ? ['', 'Context at warning level — wrap up soon'] : []),
  ].join('\n')
}

function toolGetDailySummary(): string {
  const s = dbOps.getDailySummary()

  const fmtDelta = (pct: number | null): string => {
    if (pct === null) return 'no prior data'
    if (pct === 0) return 'same'
    return pct > 0 ? `+${pct}%` : `${pct}%`
  }

  const topToolLine = s.today_top_tool
    ? `Top tool today: ${s.today_top_tool} (${s.today_top_tool_pct}% of calls)`
    : `Top tool today: -`

  const sessionsDelta = s.vs_yesterday_sessions_delta !== null && s.vs_yesterday_sessions_delta !== 0
    ? ` · ${s.vs_yesterday_sessions_delta > 0 ? '+' : ''}${s.vs_yesterday_sessions_delta} sessions`
    : ''

  return [
    `Today: ${fmtDollar(s.today_cost)} · ${s.today_sessions} session${s.today_sessions !== 1 ? 's' : ''} · ${fmtTok(s.today_tokens)} tokens`,
    `vs yesterday: ${fmtDelta(s.vs_yesterday_cost_pct)} cost${sessionsDelta}`,
    `vs 7d avg: ${fmtDelta(s.vs_7d_avg_cost_pct)} your normal`,
    topToolLine,
    `Weekly pace: on track for ~${fmtDollar(s.weekly_pace_cost)} this week`,
  ].join('\n')
}

function toolGetWeeklyInsight(days: number): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 7)))
  const data = getWeeklyInsightData(d)

  if (data.total_sessions === 0) return `No usage data for the last ${d} days.`

  const fmtDate = (ts: number): string => {
    const dt = new Date(ts)
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return [
    `Weekly insight (${fmtDate(data.week_start)} – ${fmtDate(data.week_end)})`,
    `──────────────────────────────────────────────`,
    `Sessions: ${data.total_sessions}  ·  Cost: ${fmtDollar(data.total_cost)}  ·  Loops: ${data.total_loops}`,
    `Top tool: ${data.top_tool} (${data.top_tool_cost_pct}% of cost)  ·  Efficiency: ${data.avg_efficiency}/100`,
    `Tokens: ${fmtTok(data.input_tokens)} in + ${fmtTok(data.output_tokens)} out  ·  Cache hit: ${data.cache_hit_pct}%`,
    `Tip: ${generateTip(data)}`,
  ].join('\n')
}

const DEFAULT_TOOL_DEFINITIONS: Array<{
  name: string
  description: string
  inputSchema: object
  handler: (args: Record<string, unknown>) => Promise<string> | string
}> = [
  {
    name: 'get_quota_status',
    description: 'Get current Claude Code quota status: 5h cycle usage %, plan type, weekly hours per model, and burn rate (tokens/min)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      await refreshFromApi()
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetQuotaStatus()
    },
  },
  {
    name: 'get_current_session',
    description: 'Get details about the most recent Claude Code session: cost, tokens, efficiency score, and loops detected',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetCurrentSession(),
  },
  {
    name: 'get_session_stats',
    description: 'Get aggregated session statistics for the last N days: session count, total cost, total tokens, loops, and average efficiency',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Number of days to look back (1-90, default 7)' } },
      required: [],
    },
    handler: (args) => {
      const days = typeof args.days === 'number' ? args.days : 7
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetSessionStats(days)
    },
  },
  {
    name: 'get_top_tools',
    description: 'Get the top 10 most used tools by cost, call count, or duration in the last N days',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days to look back (default 30)' },
        sort_by: { type: 'string', description: 'Sort by: cost, count, or duration (default cost)' },
      },
      required: [],
    },
    handler: (args) => {
      const days = typeof args.days === 'number' ? args.days : 30
      const sortBy = typeof args.sort_by === 'string' ? args.sort_by : 'cost'
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetTopTools(days, sortBy)
    },
  },
  {
    name: 'get_usage_insights',
    description: 'Get unique usage insights not available in /usage: cost per project, cache savings, output/input ratio, efficiency trend, and peak hours',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days to look back (default 7)' } },
      required: [],
    },
    handler: (args) => {
      const days = typeof args.days === 'number' ? args.days : 7
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetUsageInsights(days)
    },
  },
  {
    name: 'get_model_breakdown',
    description: 'Get cost and session count broken down by Claude model (Sonnet, Haiku, Opus) for the last N days',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days to look back (default 7)' } },
      required: [],
    },
    handler: (args) => {
      const days = typeof args.days === 'number' ? args.days : 7
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetModelBreakdown(days)
    },
  },
  {
    name: 'get_weekly_insight',
    description: 'Get the weekly usage summary with an actionable tip (same as claudestat weekly command)',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days to look back (default 7)' } },
      required: [],
    },
    handler: (args) => {
      const days = typeof args.days === 'number' ? args.days : 7
      return (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetWeeklyInsight(days)
    },
  },
  {
    name: 'get_context_status',
    description: 'Get current context window usage for the latest session: used tokens, window size, percentage, and model',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetContextStatus(),
  },
  {
    name: 'get_daily_summary',
    description: "Get today's usage summary vs yesterday and 7-day personal average: cost, sessions, tokens, top tool, and weekly pace",
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => (isDaemonRunning() ? '' : DAEMON_WARNING + '\n') + toolGetDailySummary(),
  },
]

function startContextPolling(): NodeJS.Timeout {
  let mcpContextThresholdsFired = new Set<number>()
  let mcpLastContextSessionId = ''
  const MCP_CONTEXT_THRESHOLDS = [50, 75, 90] as const

  let mcpWeeklyThresholdsFired = new Set<number>()
  let mcpLastWeeklyPct = 0
  const MCP_WEEKLY_THRESHOLDS = [25, 50, 75, 90, 100] as const

  let mcpCycleThresholdsFired = new Set<number>()
  let mcpLastCycleResetAt = 0
  const MCP_CYCLE_THRESHOLDS = [50, 75, 90, 100] as const

  return setInterval(() => {
    try {
      const session = dbOps.getLatestSession()
      if (!session) return

      const dominantModel = session.dominant_model ?? ''
      const contextWindow = session.context_window ?? getContextWindow(dominantModel)
      const contextUsed = session.context_used ?? 0
      if (contextWindow <= 0) return

      const pctCurrent = Math.round((contextUsed / contextWindow) * 100)
      if (session.id !== mcpLastContextSessionId) {
        if (pctCurrent < 40) mcpContextThresholdsFired.clear()
        mcpLastContextSessionId = session.id
      }

      if (pctCurrent >= 50) {
        for (const th of MCP_CONTEXT_THRESHOLDS) {
          if (pctCurrent >= th && !mcpContextThresholdsFired.has(th)) {
            mcpContextThresholdsFired.add(th)
            const usedK  = Math.round(contextUsed / 1000)
            const totalK = Math.round(contextWindow / 1000)
            const msg = th >= 90
              ? `Context at ${pctCurrent}% (${usedK}K/${totalK}K tokens) — near limit. Use /compact or /checkpoint NOW.`
              : th >= 75
              ? `Context at ${pctCurrent}% (${usedK}K/${totalK}K tokens) — consider /compact soon.`
              : `Context at ${pctCurrent}% (${usedK}K/${totalK}K tokens) — comfortable but plan ahead.`
            notifyClient(msg, th >= 90 ? 'error' : 'warning')
          }
        }
      }

      const q = computeQuota()
      const weeklyPct = q.weeklyPctAll
      if (weeklyPct < mcpLastWeeklyPct) {
        mcpWeeklyThresholdsFired.clear()
      }
      mcpLastWeeklyPct = weeklyPct
      if (weeklyPct > 0) {
        const todayDow = new Date().getDay()
        const daysFromMonday = Math.max(1, (todayDow + 6) % 7)
        for (const th of MCP_WEEKLY_THRESHOLDS) {
          if (weeklyPct >= th && !mcpWeeklyThresholdsFired.has(th)) {
            mcpWeeklyThresholdsFired.add(th)
            const daysLeft = ((100 - weeklyPct) / weeklyPct * daysFromMonday).toFixed(1)
            const weekInsight = dbOps.getWeeklyInsight(7)
            const dailyCost  = weekInsight ? `$${(weekInsight.total_cost / 7).toFixed(2)}/day` : ''
            const msg = th >= 90
              ? `Weekly quota at ${weeklyPct}% — ~${daysLeft} days remaining at this pace${dailyCost ? ` (${dailyCost})` : ''}. Prioritize critical tasks.`
              : th >= 75
              ? `Weekly quota at ${weeklyPct}%${dailyCost ? ` (${dailyCost})` : ''} — ~${daysLeft} days left. Consider reducing usage.`
              : th >= 50
              ? `Half of weekly quota used (${weeklyPct}%)${dailyCost ? ` - ${dailyCost}` : ''}. ~${daysLeft} days at this pace.`
              : `Weekly quota at ${weeklyPct}%${dailyCost ? ` (${dailyCost})` : ''}. Normal pace.`
            notifyClient(msg, th >= 90 ? 'error' : 'warning')
          }
        }
      }

      if (q.cycleResetAt !== mcpLastCycleResetAt) {
        mcpCycleThresholdsFired.clear()
        mcpLastCycleResetAt = q.cycleResetAt
      }
      const cyclePct = q.cyclePct
      if (cyclePct > 0) {
        for (const th of MCP_CYCLE_THRESHOLDS) {
          if (cyclePct >= th && !mcpCycleThresholdsFired.has(th)) {
            mcpCycleThresholdsFired.add(th)
            const resetMins = Math.ceil(q.cycleResetMs / 60_000)
            const resetLabel = resetMins >= 60 ? `${Math.floor(resetMins / 60)}h ${resetMins % 60}m` : `${resetMins}m`
            const msg = th === 100
              ? `5h cycle EXHAUSTED (${cyclePct}%). Resets in ${resetLabel}.`
              : th >= 90
              ? `${cyclePct}% of 5h cycle used — ${resetLabel} until reset. Save your progress.`
              : th >= 75
              ? `${cyclePct}% of 5h cycle used. Resets in ${resetLabel}.`
              : `${cyclePct}% of 5h cycle used (resets in ${resetLabel}). Normal pace.`
            notifyClient(msg, th >= 90 ? 'error' : 'warning')
          }
        }
      }
    } catch { /* polling non-critical */ }
  }, 30_000)
}

function notifyClient(message: string, level: 'error' | 'warning'): void {
  const json = JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level, message },
  })
  process.stdout.write(json + '\n')
}

function makeHandleRequest(tools: () => ToolDefinition[], serverName: string, serverVersion: string): (msg: JsonRpcRequest) => Promise<JsonRpcResponse | null> {
  return async function handleRequest(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params } = msg
    if (id === undefined) return null

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0', id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: serverName, version: serverVersion },
            },
          }

        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: tools().map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } }

        case 'tools/call': {
          const toolName = (params as any)?.name as string
          const toolArgs = ((params as any)?.arguments ?? {}) as Record<string, unknown>
          const def = tools().find(t => t.name === toolName)
          if (!def) {
            return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${toolName}` } }
          }
          const text = await def.handler(toolArgs)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } }
        }

        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
      }
    } catch (e: any) {
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } }
    }
  }
}

export function createMcpServer(options?: McpServerOptions): McpServer {
  const name = options?.name ?? 'claudestat'
  const version = options?.version ?? '1.15.0'
  const contextPolling = options?.contextPolling ?? false

  let _tools: ToolDefinition[] = [...DEFAULT_TOOL_DEFINITIONS]
  if (options?.tools) {
    for (const custom of options.tools) {
      const idx = _tools.findIndex(t => t.name === custom.name)
      if (idx >= 0) _tools[idx] = custom
      else _tools.push(custom)
    }
  }

  let _rl: readline.Interface | null = null
  let _pollTimer: NodeJS.Timeout | null = null
  let _started = false

  function getTools(): ToolDefinition[] {
    return _tools
  }

  const _handleRequest = makeHandleRequest(getTools, name, version)

  function handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const msg = JSON.parse(trimmed) as JsonRpcRequest
      _handleRequest(msg).then(response => {
        if (response) process.stdout.write(JSON.stringify(response) + '\n')
      }).catch((e: any) => {
        process.stderr.write(`[claudestat-mcp] Handler error: ${e.message}\n`)
      })
    } catch (e: any) {
      process.stderr.write(`[claudestat-mcp] Parse error: ${e.message}\n`)
    }
  }

  const server: McpServer = {
    get tools() { return [..._tools] },

    start() {
      if (_started) {
        process.stderr.write(`[claudestat-mcp] Server already started\n`)
        return
      }
      _started = true
      _rl = readline.createInterface({ input: process.stdin, terminal: false })
      _rl.on('line', handleLine)
      if (contextPolling) {
        _pollTimer = startContextPolling()
      }
      process.stderr.write(`[claudestat-mcp] Server ready (stdio, protocol ${PROTOCOL_VERSION})\n`)
    },

    stop() {
      if (!_started) return
      _started = false
      if (_pollTimer) {
        clearInterval(_pollTimer)
        _pollTimer = null
      }
      if (_rl) {
        _rl.close()
        _rl = null
      }
    },

    addTool(def: ToolDefinition) {
      const idx = _tools.findIndex(t => t.name === def.name)
      if (idx >= 0) _tools[idx] = def
      else _tools.push(def)
    },

    removeTool(name: string) {
      const idx = _tools.findIndex(t => t.name === name)
      if (idx >= 0) _tools.splice(idx, 1)
    },
  }

  return server
}
