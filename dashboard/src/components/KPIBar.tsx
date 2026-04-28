import { memo } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import {
  Activity, Timer, Cpu, Flame, BrainCircuit, Files,
  Settings2, Bell, CircleX, TriangleAlert, Info,
  CheckCircle2, type LucideIcon,
} from 'lucide-react'
import type { MetaStats, MetaSnapshot, MetaAlert, CostInfo, QuotaData, SessionState } from '../types'

interface Props {
  meta?:         MetaStats
  history:       MetaSnapshot[]
  cost?:         CostInfo
  quota?:        QuotaData
  sessionState?: SessionState
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const S = {
  bar: {
    background: '#0d1117',
    borderBottom: '1px solid #21262d',
    padding: '6px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    overflowX: 'auto' as const,
    minHeight: 56,
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '4px 16px',
    borderRight: '1px solid #21262d',
    minWidth: 0,
    flexShrink: 0,
  },
  labelRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    color: '#7d8590', fontSize: 10, whiteSpace: 'nowrap' as const,
    marginBottom: 2,
  },
  value:  { color: '#e6edf3', fontWeight: 700, fontSize: 13 },
  sub:    { color: '#7d8590', fontSize: 10 },
  sparkWrap: { width: 60, height: 28, flexShrink: 0 },

  alertsWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '0 16px',
    minWidth: 200,
    maxWidth: 400,
    flex: 1,
  },
  alertLabelRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    color: '#7d8590', fontSize: 10, marginBottom: 2,
    whiteSpace: 'nowrap' as const,
  },
  alert: (level: MetaAlert['level']): React.CSSProperties => {
    const colors = { info: '#58a6ff', warning: '#d29922', critical: '#f85149' }
    const c = colors[level]
    return {
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: 10, color: c,
      background: c + '15', border: `1px solid ${c}30`,
      borderRadius: 3, padding: '2px 6px',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden', textOverflow: 'ellipsis',
    }
  },
  noAlerts: {
    display: 'flex', alignItems: 'center', gap: 4,
    color: '#3fb950', fontSize: 10,
  } as React.CSSProperties,
}

function Sparkline({ data, dataKey, color }: { data: MetaSnapshot[]; dataKey: keyof MetaSnapshot; color: string }) {
  if (data.length < 2) {
    return (
      <div style={{ ...S.sparkWrap, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#7d8590', fontSize: 9 }}>—</span>
      </div>
    )
  }
  return (
    <div style={S.sparkWrap}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Area
            type="monotone"
            dataKey={dataKey as string}
            stroke={color}
            fill={color + '22'}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={{ background: '#161b22', border: `1px solid ${color}44`, borderRadius: 4, fontSize: 10, padding: '2px 6px' }}
            itemStyle={{ color }}
            labelFormatter={() => ''}
            formatter={(v: number) => [fmtTok(v), '']}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function KPICard({
  icon: Icon, label, value, sub, tooltip, sparkData, sparkKey, color
}: {
  icon: LucideIcon; label: string; value: string; sub?: string; tooltip?: string
  sparkData: MetaSnapshot[]; sparkKey: keyof MetaSnapshot; color: string
}) {
  return (
    <div style={S.card} title={tooltip}>
      <div>
        <div style={S.labelRow}>
          <Icon size={10} />
          <span>{label}</span>
        </div>
        <div style={S.value}>{value}</div>
        {sub && <div style={S.sub}>{sub}</div>}
      </div>
      <Sparkline data={sparkData} dataKey={sparkKey} color={color} />
    </div>
  )
}

function ModelBar({ label, color, hours, limit }: { label: string; color: string; hours: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round(hours / limit * 100)) : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color, fontSize: 9, fontWeight: 700, width: 42, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e6edf3', fontSize: 10, fontWeight: 600, width: 32, textAlign: 'right', flexShrink: 0 }}>
        {hours > 0 ? `${hours}h` : '—'}
      </span>
      {pct !== null ? (
        <>
          <div style={{ width: 50, height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : color,
              borderRadius: 2,
            }} />
          </div>
          <span style={{ color: '#7d8590', fontSize: 9 }}>{pct}%</span>
        </>
      ) : (
        <span style={{ color: '#7d8590', fontSize: 9 }}>no limit</span>
      )}
    </div>
  )
}

const STATE_META: Record<SessionState, { label: string; color: string; pulse: boolean }> = {
  working:           { label: 'working', color: '#3fb950', pulse: true  },
  waiting_for_input: { label: 'waiting', color: '#58a6ff', pulse: false },
  idle:              { label: 'idle',    color: '#7d8590', pulse: false },
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', max5: 'Max 5×', max20: 'Max 20×',
}

function fmtResetTime(resetAt: number): { relative: string; absolute: string } {
  const now    = Date.now()
  const ms     = resetAt - now
  const absStr = new Date(resetAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (ms <= 0) return { relative: 'now', absolute: absStr }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const relative = h > 0 ? `${h}h ${m}m` : `${m}m`
  return { relative, absolute: absStr }
}

const ALERT_ICONS: Record<MetaAlert['level'], LucideIcon> = {
  info:     Info,
  warning:  TriangleAlert,
  critical: CircleX,
}

// Umbral real de auto-compact de Claude Code ≈ 85% de la ventana total.
// keep in sync with TracePanel.tsx (SidebarKPI)
const COMPACT_THRESHOLD = 0.85

function KPIBarInner({ meta, history, cost, quota, sessionState = 'idle' }: Props) {
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100))
    : null
  const remaining  = contextPct !== null ? 100 - contextPct : null
  const ctxColor   = remaining === null ? '#7d8590'
    : remaining < 15 ? '#f85149' : remaining < 35 ? '#d29922' : '#3fb950'

  const overheadColor = !meta || meta.contextOverheadTokens === 0 ? '#7d8590'
    : meta.contextOverheadTokens > 20_000 ? '#f85149'
    : meta.contextOverheadTokens > 10_000 ? '#d29922'
    : '#3fb950'

  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  if (contextPct !== null && contextPct > 85) {
    alerts.push({ level: 'critical', message: `Auto-compact soon — ~${remaining}% until threshold`, metric: 'context' })
  } else if (contextPct !== null && contextPct > 65) {
    alerts.push({ level: 'warning', message: `Context at ${contextPct}% of auto-compact threshold`, metric: 'context' })
  }

  const sm = STATE_META[sessionState]

  return (
    <>
    <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }`}</style>
    <div style={S.bar}>

      {/* KPI: Estado */}
      <div style={{ ...S.card, minWidth: 100 }} title="Current state of the active session detected by claudestat.\nworking: Claude is executing tools · waiting: awaiting confirmation or input · idle: no activity">
        <div>
          <div style={S.labelRow}>
            <Activity size={10} />
            <span>Status</span>
          </div>
          <div style={{ ...S.value, color: sm.color, display: 'flex', alignItems: 'center', gap: 5 }}>
            {sm.pulse && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: sm.color, display: 'inline-block',
                boxShadow: `0 0 6px ${sm.color}`,
                animation: 'pulse 1.2s ease-in-out infinite',
              }} />
            )}
            {sm.label}
          </div>
        </div>
      </div>

      {/* KPI: Quota 5h */}
      {quota && (
        <div style={S.card} title="Estimate based on Claude Code only. Does not include usage from claude.ai web. For exact data: claude.ai → Settings → Usage.">
          <div>
            <div style={S.labelRow}>
              <Timer size={10} />
              <span>Est. quota · {PLAN_LABEL[quota.detectedPlan] ?? quota.detectedPlan}</span>
            </div>
            <div style={{
              ...S.value,
              color: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#e6edf3',
            }}>
              {quota.cyclePrompts}/{quota.cycleLimit}
              <span style={{ ...S.sub, marginLeft: 5 }}>{quota.cyclePct}%</span>
            </div>
            {(() => {
              const reset = fmtResetTime(quota.cycleResetAt ?? (Date.now() + quota.cycleResetMs))
              return (
                <div style={S.sub} title="Rolling window from first message in Claude Code">
                  resets in {reset.relative} · {reset.absolute}
                </div>
              )
            })()}
          </div>
          <div style={{ width: 6, height: 36, background: '#21262d', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{
              width: '100%',
              height: `${quota.cyclePct}%`,
              background: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#3fb950',
              borderRadius: 3,
              transition: 'height 0.3s ease',
              boxShadow: `0 0 4px ${quota.cyclePct > 85 ? '#f85149' : '#3fb95088'}`,
            }} />
          </div>
        </div>
      )}

      {/* KPI: Modelos */}
      {quota && (
        <div style={S.card} title="Model activity hours this week, estimated from Claude Code. Does not include usage from claude.ai web.">
          <div>
            <div style={S.labelRow}>
              <Cpu size={10} />
              <span>Models · this week</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              <ModelBar label="Sonnet" color="#58a6ff" hours={quota.weeklyHoursSonnet} limit={quota.weeklyLimitSonnet} />
              {quota.weeklyLimitOpus > 0 && (
                <ModelBar label="Opus" color="#d29922" hours={quota.weeklyHoursOpus} limit={quota.weeklyLimitOpus} />
              )}
              {(quota.weeklyHoursHaiku ?? 0) > 0 && (
                <ModelBar label="Haiku" color="#3fb950" hours={quota.weeklyHoursHaiku!} limit={0} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI: Consumo tok/min (burn rate) */}
      {quota && quota.burnRateTokensPerMin > 0 && (
        <div style={S.card} title="Tokens consumed per minute in the last 30 min (input + output).\nSonnet 4.6: ~$3/M input · ~$15/M output. A high value indicates intensive sessions or loops.">
          <div>
            <div style={S.labelRow}>
              <Flame size={10} />
              <span>Burn rate</span>
            </div>
            <div style={S.value}>{quota.burnRateTokensPerMin.toLocaleString()} tok/min</div>
            <div style={S.sub}>last 30 min</div>
          </div>
        </div>
      )}

      {/* KPI: Contexto */}
      <div style={S.card} title={`% free calculated over the auto-compact threshold (${Math.round(COMPACT_THRESHOLD * 100)}% of total window).\nAligns with "X% until auto-compact" in the Claude Code terminal.\nTotal window: ${fmtTok(cost?.context_window ?? 200_000)} · Threshold: ${fmtTok(compactWindow ?? 170_000)}`}>
        <div>
          <div style={S.labelRow}>
            <BrainCircuit size={10} />
            <span>Session context</span>
          </div>
          <div style={{ ...S.value, color: ctxColor }}>
            {remaining !== null ? `~${remaining}% free` : '—'}
          </div>
          {cost?.context_used && compactWindow ? (
            <div style={S.sub}>
              {fmtTok(cost.context_used)} / {fmtTok(compactWindow)}
              <span style={{ color: '#7d859066', marginLeft: 4 }}>threshold</span>
            </div>
          ) : (
            <div style={S.sub}>calculating…</div>
          )}
        </div>
        <div style={{ width: 6, height: 36, background: '#21262d', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
          {remaining !== null && (
            <div style={{
              width: '100%',
              height: `${remaining}%`,
              background: ctxColor,
              borderRadius: 3,
              marginTop: `${contextPct}%`,
              boxShadow: `0 0 4px ${ctxColor}88`,
            }} />
          )}
        </div>
      </div>

      {/* KPI: Archivos de contexto */}
      <KPICard
        icon={Files} label="Context files"
        value={meta ? (meta.contextOverheadTokens > 0 ? `~${fmtTok(meta.contextOverheadTokens)} tok` : 'none') : '—'}
        sub={meta && meta.contextFiles.length > 0
          ? `${meta.contextFiles.length} file${meta.contextFiles.length > 1 ? 's' : ''} detected`
          : meta ? 'none detected' : undefined
        }
        tooltip={meta?.contextFiles.map(f => `${f.label}: ~${fmtTok(f.tokens)} tok`).join('\n')}
        sparkData={history} sparkKey="contextOverheadTokens" color={overheadColor}
      />

      {/* Alertas */}
      <div style={S.alertsWrap}>
        <div style={S.alertLabelRow}>
          <Bell size={10} />
          <span>{alerts.length > 0 ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : 'Alerts'}</span>
        </div>
        {alerts.length === 0 ? (
          <div style={S.noAlerts}>
            <CheckCircle2 size={11} />
            <span>All good</span>
          </div>
        ) : (
          alerts.slice(0, 3).map((a, i) => {
            const AlertIcon = ALERT_ICONS[a.level]
            return (
              <div key={i} style={S.alert(a.level)}>
                <AlertIcon size={10} />
                {a.message}
              </div>
            )
          })
        )}
      </div>

    </div>
    </>
  )
}

export const KPIBar = memo(KPIBarInner)
