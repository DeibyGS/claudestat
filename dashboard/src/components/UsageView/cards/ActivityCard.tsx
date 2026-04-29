import { Activity, Calendar, Clock, MessageSquare, TrendingUp, Wrench, Zap } from 'lucide-react'
import type { TraceEvent, CostInfo, ClaudeStatsData, QuotaData } from '../../../types'
import { Tip } from '../../Tip'
import { PRICE_PER_M, fmtTok, fmtUsd, getModelPrice, getModelShortName } from '../utils'
import { Card, CardHeader, InfoTip } from './StatusCard'

// ─── Actividad por categoría ───────────────────────────────────────────────────

const CATEGORY_TIPS: Record<string, string> = {
  'Reading':  'Read, Grep, Glob — tools for reading and searching files. High % may indicate excessive exploration before editing.',
  'Editing':  'Edit, Write, NotebookEdit — tools that modify files. This is the real productive work.',
  'Terminal': 'Bash — shell commands executed directly. Many Bash + few Grep may indicate inefficient searches.',
  'Search': 'WebFetch, WebSearch — internet and web page searches.',
  'Agents':  'Agent, Task, SendMessage — sub-agents launched for parallel tasks. They consume their own context quota.',
  'Others':    'Tools that don\'t fit in previous categories (Config, ToolSearch, etc.).',
}

const ACTIVITY_CATEGORIES: { label: string; tools: string[]; color: string }[] = [
  { label: 'Reading',   tools: ['Read', 'Grep', 'Glob'],                        color: '#58a6ff' },
  { label: 'Editing',   tools: ['Edit', 'Write', 'NotebookEdit'],               color: '#3fb950' },
  { label: 'Terminal',  tools: ['Bash'],                                         color: '#d29922' },
  { label: 'Search',  tools: ['WebFetch', 'WebSearch'],                        color: '#bc8cff' },
  { label: 'Agents',   tools: ['Agent', 'Task', 'SendMessage'],                 color: '#f0883e' },
]

export function classifyTool(toolName: string): number {
  for (let i = 0; i < ACTIVITY_CATEGORIES.length; i++) {
    if (ACTIVITY_CATEGORIES[i].tools.some(t => toolName.startsWith(t))) return i
  }
  return ACTIVITY_CATEGORIES.length  // "Otros"
}

// ─── Card: Distribución de actividad ─────────────────────────────────────────

export function ActivityCard({ events, cost }: { events: TraceEvent[]; cost?: CostInfo }) {
  const done = events.filter(e => e.type === 'Done' && e.tool_name)
  if (done.length === 0) return null

  // Contar tool calls por categoría
  const counts = new Array(ACTIVITY_CATEGORIES.length + 1).fill(0)
  for (const e of done) counts[classifyTool(e.tool_name!)]++

  const total = done.length
  const outputTokens = cost?.output_tokens ?? 0

  const rows = [
    ...ACTIVITY_CATEGORIES.map((cat, i) => ({ ...cat, count: counts[i] })),
    { label: 'Others', color: '#484f58', count: counts[ACTIVITY_CATEGORIES.length] },
  ].filter(r => r.count > 0).sort((a, b) => b.count - a.count)

  return (
    <Card>
      <CardHeader icon={Activity} title="Activity distribution" subtitle="current session" />

      {/* Segmented bar */}
      <div style={{ height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 12 }}>
        {rows.map(r => (
          <div
            key={r.label}
            style={{ width: `${r.count / total * 100}%`, height: '100%', background: r.color }}
          />
        ))}
      </div>

      {/* Rows by category */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => {
          const pct      = Math.round(r.count / total * 100)
          const estTok   = outputTokens > 0 ? Math.round(outputTokens * r.count / total) : 0
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#8b949e', minWidth: 70 }}>{r.label}</span>
              <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: r.color, opacity: 0.7, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: '#6e7681', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
                {pct}%
              </span>
              <span style={{ fontSize: 10, color: '#484f58', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
                {estTok > 0 ? `~${fmtTok(estTok)}` : `${r.count}×`}
              </span>
              <InfoTip position="top" align="right" style={{ flexShrink: 0 }} content={
                <div>
                  <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{r.label}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>{CATEGORY_TIPS[r.label] ?? ''}</div>
                </div>
              } />
            </div>
          )
        })}
        <div style={{ fontSize: 9, color: '#3d444d', marginTop: 2 }}>
          {total} tool calls · {outputTokens > 0 ? `~${fmtTok(outputTokens)} estimated output tokens` : 'tokens pending from active session'}
        </div>
      </div>
    </Card>
  )
}

// ─── Card: Actividad de hoy (stats-cache.json) ────────────────────────────────

export function DailyActivityCard({ stats }: { stats: ClaudeStatsData }) {
  const day   = stats.today
  const label = stats.todayLabel
  const last7 = stats.last7

  if (!day && last7.messages === 0) {
    return (
      <Card>
        <CardHeader icon={Activity} title="Activity (stats-cache.json)" />
        <span style={{ fontSize: 12, color: '#484f58' }}>No data yet in stats-cache.json</span>
      </Card>
    )
  }

  const cols = [
    {
      label: 'Messages', icon: MessageSquare, today: day?.messages ?? 0, week: last7.messages, color: '#58a6ff',
      tooltip: 'Total messages (human + assistant).\nDivide by 2 to estimate real prompts.\nSource: ~/.claude/stats-cache.json',
    },
    {
      label: 'Sessions', icon: Clock, today: day?.sessions ?? 0, week: last7.sessions, color: '#3fb950',
      tooltip: 'Different conversations started with Claude Code.\nEach time you run "claude" in a directory counts as a session.',
    },
    {
      label: 'Tools', icon: Wrench, today: day?.tools ?? 0, week: last7.tools, color: '#d29922',
      tooltip: 'Tool calls executed (Read, Edit, Bash, Grep…).\nHigh number indicates code-intensive sessions.',
    },
    {
      label: 'Out tokens', icon: Zap, today: day?.outputTokens ?? 0, week: last7.outputTokens, color: '#a371f7', fmt: fmtTok,
      tooltip: 'Tokens generated by Claude in responses.\nThese most influence session cost.',
    },
  ]

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} color="#58a6ff" />
          <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>Activity</span>
          {label && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 2 }}>{label} / 7 days</span>}
        </div>
        {stats.cacheDate && (
          <span style={{ fontSize: 9, color: '#3d444d' }}>cache: {stats.cacheDate}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, justifyItems: 'center' }}>
        {cols.map(col => {
          const fmt = (col as { fmt?: (n: number) => string }).fmt ?? ((n: number) => n.toLocaleString())
          return (
            <Tip
              key={col.label}
              position="bottom"
              content={
                <div>
                  <div style={{ color: col.color, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{col.label}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{col.tooltip}</div>
                </div>
              }
            >
              <div style={{ textAlign: 'center', cursor: 'help' }}>
                <col.icon size={11} color={col.color} style={{ marginBottom: 4 }} />
                <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 2, fontWeight: 600 }}>{col.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: col.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(col.today)}
                </div>
                <div style={{ fontSize: 9, color: '#484f58', marginBottom: 4 }}>{label ?? '—'}</div>
                <div style={{ fontSize: 11, color: '#6e7681', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(col.week)}
                </div>
                <div style={{ fontSize: 9, color: '#3d444d' }}>7 days</div>
              </div>
            </Tip>
          )
        })}
      </div>
      <div style={{ fontSize: 9, color: '#3d444d', marginTop: 10 }}>
        Source: ~/.claude/stats-cache.json · Messages include human + assistant (÷2 ≈ real prompts) · {stats.allTime.sessions} total sessions
      </div>
      {stats.cacheIsStale && (
        <div style={{ fontSize: 9, color: '#d29922', marginTop: 4 }}>
          ⚠ Stale cache ({stats.cacheDate}) — Claude Code updates this file when each CLI session ends
        </div>
      )}
    </Card>
  )
}

// ─── Card: Proyección mensual ──────────────────────────────────────────────────

export function ProjectionCard({ quota, cost }: { quota: QuotaData; cost?: CostInfo }) {
  const weeklyTokens    = (quota.weeklyTokensSonnet ?? 0) + (quota.weeklyTokensOpus ?? 0) + (quota.weeklyTokensHaiku ?? 0)
  const weeklyCost      = ((quota.weeklyTokensSonnet ?? 0) / 1_000_000) * PRICE_PER_M.sonnet
    + ((quota.weeklyTokensOpus   ?? 0) / 1_000_000) * PRICE_PER_M.opus
    + ((quota.weeklyTokensHaiku  ?? 0) / 1_000_000) * PRICE_PER_M.haiku
  const monthlyCost     = weeklyCost * 4.3
  const dailyCost       = weeklyCost / 7

  const burnModelPrice = getModelPrice(cost?.model ?? '')
  const burnModelName  = getModelShortName(cost?.model ?? '')
  const burnUsdPerHour = quota.burnRateTokensPerMin > 0
    ? ((quota.burnRateTokensPerMin * 60) / 1_000_000) * burnModelPrice
    : 0

  return (
    <Card>
      <CardHeader icon={TrendingUp} title="Monthly projection" subtitle="based on this week" />
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Monthly projection</div>
            <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
              Weekly consumption × 4.3 (weeks/month).<br />
              Assumes upcoming weeks will have the same pace.<br />
              Based on actual Sonnet, Opus, and Haiku tokens with blended prices.
            </div>
          </div>
        }>
          <div style={{ cursor: 'help' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e6edf3', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {weeklyCost > 0 ? `~${fmtUsd(monthlyCost)}` : '—'}
            </div>
            <div style={{ fontSize: 9, color: '#484f58' }}>/month · {weeklyCost > 0 ? `${fmtUsd(weeklyCost)}/week · ${fmtUsd(dailyCost)}/day` : 'no data'}</div>
          </div>
        </Tip>
        {burnUsdPerHour > 0 && (
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Cost per hour (now)</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                Calculated with active model ({burnModelName}) at blended price.<br />
                {quota.burnRateTokensPerMin.toLocaleString()} tok/min × 60 ÷ 1M × price/M
              </div>
            </div>
          }>
            <div style={{ cursor: 'help' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#d29922', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                ~{fmtUsd(burnUsdPerHour)}/h
              </div>
              <div style={{ fontSize: 9, color: '#484f58' }}>now · {quota.burnRateTokensPerMin.toLocaleString()} tok/min</div>
            </div>
          </Tip>
        )}
      </div>
      {weeklyTokens > 0 && (
        <div style={{ fontSize: 10, color: '#484f58' }}>
          {fmtTok(weeklyTokens)} tokens this week · estimated blended input/output prices
        </div>
      )}
    </Card>
  )
}
