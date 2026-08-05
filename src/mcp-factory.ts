import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
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
  stop(): Promise<void>
  addTool(def: ToolDefinition): void
  removeTool(name: string): void
  readonly tools: ToolDefinition[]
}

const DAEMON_WARNING = `claudestat daemon is not running — real-time monitoring is disabled.
Start it with: claudestat start

Data shown below is from the last recorded session.
---`

// ─── JSON-schema → Zod conversion ─────────────────────────────────────────────
// The SDK's registerTool requires a Zod schema/raw shape, but the public
// ToolDefinition.inputSchema is a plain JSON-schema object. Only a small subset
// of types is used today (number/string/boolean), so the converter is minimal.

function jsonSchemaToZodShape(schema: Record<string, unknown> | undefined): z.ZodRawShape | undefined {
  if (!schema || (schema as any).type !== 'object') return undefined
  const props = ((schema as any).properties ?? {}) as Record<string, any>
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  const shape: z.ZodRawShape = {}
  for (const [key, prop] of Object.entries(props)) {
    let zz: z.ZodTypeAny
    switch (prop?.type) {
      case 'number':   zz = z.number(); break
      case 'integer':  zz = z.number().int(); break
      case 'string':   zz = z.string(); break
      case 'boolean':  zz = z.boolean(); break
      default:         zz = z.unknown()
    }
    shape[key] = required.includes(key) ? zz : zz.optional()
  }
  return Object.keys(shape).length ? shape : undefined
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

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

// Small indirection so tests can inject a PID file path via env override.
// Exported only for tests — not part of the public lib.ts API.
export function isDaemonRunning(): boolean {
  try {
    const pid = parseInt(fs_readPidFile(), 10)
    if (!Number.isInteger(pid) || pid <= 0) return false
    if (pid === process.pid) return false
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // ESRCH = process doesn't exist → false. EPERM = exists but owned by another
    // user → treat as running (the daemon runs under the same user, so this is a
    // false-negative avoidance).
    return err?.code === 'EPERM'
  }
}

// Small indirection so tests can inject a PID file path via env override.
function fs_readPidFile(): string {
  try {
    return require('fs').readFileSync(getPidFile(), 'utf8').trim()
  } catch {
    return ''
  }
}

// ─── Tool handlers de negocio (sin cambios de contenido) ──────────────────────

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

// Exported only for tests — not part of the public lib.ts API.
export function progressBar(pct: number, width = 20): string {
  const p = Math.max(0, Math.min(100, pct))
  const filled = Math.round(p / 100 * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

function toolGetUsageInsights(days: number): string {
  const d = Math.max(1, Math.min(90, Math.floor(days || 7)))
  const i = getUsageInsights(d)

  if (i.total_sessions === 0) return `No data for the last ${d} days.`

  const bar = (pct: number, width = 20): string => progressBar(pct, width)

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

  const bar = (p: number, width = 20): string => progressBar(p, width)

  const level = pct >= 90 ? 'RED' : pct >= 75 ? 'ORA' : pct >= 50 ? 'YEL' : 'GRN'

  return [
    `Context status — ${session.id.slice(0, 8)}`,
    ``,
    `  ${level}  ${pct}%  ${bar(pct)}`,
    `  Used:  ${contextUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`,
    `  Model: ${dominantModel || 'unknown'}`,
    `  Project: ${require('path').basename(session.project_path ?? '') || '-'}`,
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

// ─── Default tools (mismo conjunto y comportamiento que v1.15) ────────────────

const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
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

// ─── Context polling (push notifications) ─────────────────────────────────────

const MCP_CONTEXT_THRESHOLDS = [50, 75, 90] as const
const MCP_WEEKLY_THRESHOLDS = [25, 50, 75, 90, 100] as const
const MCP_CYCLE_THRESHOLDS = [50, 75, 90, 100] as const

function startContextPolling(sdk: SdkMcpServer): NodeJS.Timeout {
  let mcpContextThresholdsFired = new Set<number>()
  let mcpLastContextSessionId = ''
  let mcpWeeklyThresholdsFired = new Set<number>()
  let mcpLastWeeklyPct = 0
  let mcpCycleThresholdsFired = new Set<number>()
  let mcpLastCycleResetAt = 0

  const notify = (message: string, level: 'error' | 'warning'): void => {
    void sdk.server.notification({ method: 'notifications/message', params: { level, message } })
  }

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
            notify(msg, th >= 90 ? 'error' : 'warning')
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
            notify(msg, th >= 90 ? 'error' : 'warning')
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
            notify(msg, th >= 90 ? 'error' : 'warning')
          }
        }
      }
    } catch { /* polling non-critical */ }
  }, 30_000)
}

// ─── Factory ──────────────────────────────────────────────────────────────────

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

  const sdk = new SdkMcpServer({ name, version }, { capabilities: { tools: {} } })
  const _sdkToolHandles = new Map<string, { remove(): void }>()
  let _transport: Transport | null = null
  let _pollTimer: NodeJS.Timeout | null = null
  let _started = false

  function registerTool(def: ToolDefinition): void {
    const zodShape = jsonSchemaToZodShape(def.inputSchema as Record<string, unknown>)
    // registerTool is heavily generic over the input schema; the dynamic shape
    // makes TS infer an unbounded type. Register through a typed helper so the
    // SDK never infers the argument shape from our dynamic schema.
    const register = (sdk.registerTool as (
      name: string,
      config: { title?: string; description?: string; inputSchema?: z.ZodRawShape },
      cb: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult,
    ) => { remove(): void }).bind(sdk)
    const handle = register(
      def.name,
      { title: def.name, description: def.description, inputSchema: zodShape },
      async (args) => {
        const text = await def.handler(args)
        const result: CallToolResult = { content: [{ type: 'text', text }] }
        return result
      },
    )
    _sdkToolHandles.set(def.name, handle)
  }

  function syncToolRegistry(): void {
    for (const def of _tools) registerTool(def)
  }

  const server: McpServer = {
    get tools() { return [..._tools] },

    start() {
      if (_started) {
        process.stderr.write(`[claudestat-mcp] Server already started\n`)
        return
      }
      _started = true
      syncToolRegistry()

      // Exit on stdin close so the process never lingers after the MCP client
      // disconnects (AC-11). Registered synchronously because the transport's own
      // onclose is wired asynchronously inside sdk.connect() and can miss an EOF
      // that arrives before the handshake completes.
      const onStdinClose = (): void => {
        if (!_started) return
        _started = false
        if (_pollTimer) {
          clearInterval(_pollTimer)
          _pollTimer = null
        }
        process.exit(0)
      }
      process.stdin.on('close', onStdinClose)

      void (async () => {
        const transport = new StdioServerTransport()
        _transport = transport
        try {
          await sdk.connect(transport)
        } catch (err: any) {
          process.stderr.write(`[claudestat-mcp] Connect error: ${err.message}\n`)
          process.exit(1)
        }
      })()
      if (contextPolling) {
        _pollTimer = startContextPolling(sdk)
      }
      process.stderr.write(`[claudestat-mcp] Server ready (stdio)\n`)
    },

    async stop() {
      if (!_started && !_transport) return
      _started = false
      if (_pollTimer) {
        clearInterval(_pollTimer)
        _pollTimer = null
      }
      try {
        await sdk.close()
      } catch { /* already closed */ }
    },

    addTool(def: ToolDefinition) {
      const idx = _tools.findIndex(t => t.name === def.name)
      if (idx >= 0) _tools[idx] = def
      else _tools.push(def)
      if (_started) {
        // SDK registerTool is idempotent per name — re-registering overwrites.
        registerTool(def)
      }
    },

    removeTool(name: string) {
      const idx = _tools.findIndex(t => t.name === name)
      if (idx >= 0) _tools.splice(idx, 1)
      const handle = _sdkToolHandles.get(name)
      if (handle) {
        handle.remove()
        _sdkToolHandles.delete(name)
      }
    },
  }

  // Internal test hook: connect over an arbitrary in-memory transport instead of
  // stdio. Not part of the public McpServer interface.
  ;(server as any).connectForTest = async (transport: Transport) => {
    _started = true
    syncToolRegistry()
    await sdk.connect(transport)
  }

  return server
}
