import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import type { MetaStats, MetaSnapshot, MetaAlert, CostInfo, QuotaData, SessionState } from '../types'

interface Props {
  meta?:         MetaStats
  history:       MetaSnapshot[]
  cost?:         CostInfo
  quota?:        QuotaData
  sessionState?: SessionState
}

const ENGRAM_LIMIT = 1_000_000

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
  label:  { color: '#7d8590', fontSize: 10, whiteSpace: 'nowrap' as const },
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
  alert: (level: MetaAlert['level']): React.CSSProperties => {
    const colors = { info: '#58a6ff', warning: '#d29922', critical: '#f85149' }
    const c = colors[level]
    return {
      fontSize: 10,
      color: c,
      background: c + '15',
      border: `1px solid ${c}30`,
      borderRadius: 3,
      padding: '2px 6px',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }
  },
  noAlerts: { color: '#3fb950', fontSize: 10 } as React.CSSProperties,
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
  icon, label, value, sub, sparkData, sparkKey, color
}: {
  icon: string; label: string; value: string; sub?: string
  sparkData: MetaSnapshot[]; sparkKey: keyof MetaSnapshot; color: string
}) {
  return (
    <div style={S.card}>
      <div>
        <div style={S.label}>{icon} {label}</div>
        <div style={S.value}>{value}</div>
        {sub && <div style={S.sub}>{sub}</div>}
      </div>
      <Sparkline data={sparkData} dataKey={sparkKey} color={color} />
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

function fmtResetTime(ms: number): { relative: string; absolute: string } {
  const absTs  = Date.now() + ms
  const absStr = new Date(absTs).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (ms <= 0) return { relative: 'ahora', absolute: absStr }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const relative = h > 0 ? `${h}h ${m}m` : `${m}m`
  return { relative, absolute: absStr }
}

export function KPIBar({ meta, history, cost, quota, sessionState = 'idle' }: Props) {
  // Contexto: viene de cost (datos del último mensaje del JSONL — puede tener lag de ~1 respuesta)
  const contextPct = cost?.context_used && cost.context_window
    ? Math.round(cost.context_used / cost.context_window * 100)
    : null
  const remaining  = contextPct !== null ? 100 - contextPct : null
  // Umbral conservador: alerta temprana a 60% libre porque el dato lleva ~1 respuesta de lag
  const ctxColor   = remaining === null ? '#7d8590'
    : remaining < 15 ? '#f85149' : remaining < 35 ? '#d29922' : '#3fb950'

  // Engramar: porcentaje del límite estimado 1M
  const engramPct  = meta ? Math.round(meta.engramTokens / ENGRAM_LIMIT * 100) : null
  const engramColor = engramPct === null ? '#7d8590'
    : engramPct > 80 ? '#f85149' : engramPct > 60 ? '#d29922' : '#58a6ff'

  // HANDOFF: semáforo por tamaño
  const handoffColor = !meta || meta.handoffTokens === 0 ? '#7d8590'
    : meta.handoffTokens > 5000 ? '#f85149'
    : meta.handoffTokens > 2500 ? '#d29922'
    : '#3fb950'

  // Combinar alertas: del meta + del contexto
  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  // Umbrales conservadores: dato tiene ~1 respuesta de lag vs Claude Code real-time
  if (contextPct !== null && contextPct > 85) {
    alerts.push({ level: 'critical', message: `Auto-compact muy pronto — ${remaining}% libre (dato: último msg)`, metric: 'context' })
  } else if (contextPct !== null && contextPct > 65) {
    alerts.push({ level: 'warning', message: `Contexto al ${contextPct}% — revisar terminal Claude Code`, metric: 'context' })
  }

  const sm = STATE_META[sessionState]

  return (
    <>
    <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }`}</style>
    <div style={S.bar}>

      {/* KPI: Estado de sesión */}
      <div style={{ ...S.card, minWidth: 100 }}>
        <div>
          <div style={S.label}>⚡ Estado</div>
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
        <div style={S.card}>
          <div>
            <div style={S.label}>📊 Cuota 5h · {PLAN_LABEL[quota.detectedPlan] ?? quota.detectedPlan}</div>
            <div style={{
              ...S.value,
              color: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#e6edf3',
            }}>
              {quota.cyclePrompts}/{quota.cycleLimit}
              <span style={{ ...S.sub, marginLeft: 5 }}>{quota.cyclePct}%</span>
            </div>
            {(() => {
              const reset = fmtResetTime(quota.cycleResetMs)
              return (
                <div style={S.sub} title="Estimado — puede diferir ±30 min de la web de Claude">
                  reset en {reset.relative} · {reset.absolute} ~
                </div>
              )
            })()}
          </div>
          {/* Mini progress bar */}
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

      {/* KPI: Burn rate + semanal */}
      {quota && (
        <div style={S.card}>
          <div>
            <div style={S.label}>🔥 Burn rate</div>
            <div style={S.value}>
              {quota.burnRateTokensPerMin > 0
                ? `${quota.burnRateTokensPerMin.toLocaleString()} tok/min`
                : '—'}
            </div>
            <div style={S.sub}>
              sem: {quota.weeklyHoursSonnet}h Sonnet
              {quota.weeklyHoursOpus > 0 ? ` · ${quota.weeklyHoursOpus}h Opus` : ''}
            </div>
          </div>
        </div>
      )}

      {/* KPI: Contexto sesión */}
      <div style={S.card}>
        <div>
          <div style={S.label}>🧠 Contexto sesión</div>
          <div style={{ ...S.value, color: ctxColor }}>
            {remaining !== null ? `${remaining}% libre` : '—'}
          </div>
          {cost?.context_used ? (
            <div style={S.sub}>
              {fmtTok(cost.context_used)} / {fmtTok(cost.context_window ?? 200_000)}
              <span style={{ color: '#7d859066', marginLeft: 4 }}>~último msg</span>
            </div>
          ) : (
            <div style={S.sub}>calculando…</div>
          )}
        </div>
        {/* Mini progress bar vertical */}
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

      {/* KPI: Engram tokens */}
      <KPICard
        icon="🗃️" label="Engram memoria"
        value={meta ? fmtTok(meta.engramTokens) : '—'}
        sub={engramPct !== null ? `${engramPct}% de 1M · ${meta?.engramFileCount ?? 0} archivos` : undefined}
        sparkData={history} sparkKey="engramTokens" color={engramColor}
      />

      {/* KPI: HANDOFF activo */}
      <KPICard
        icon="📋" label="HANDOFF activo"
        value={meta ? (meta.handoffTokens > 0 ? `~${fmtTok(meta.handoffTokens)} tok` : 'no encontrado') : '—'}
        sub={meta && meta.handoffTokens > 0 ? (
          meta.handoffTokens > 5000 ? '⚠ muy largo' :
          meta.handoffTokens > 2500 ? '⚠ largo' : '✓ ok'
        ) : undefined}
        sparkData={history} sparkKey="handoffTokens" color={handoffColor}
      />

      {/* KPI: Config (settings + CLAUDE.md) */}
      <KPICard
        icon="⚙️" label="Config + instrucciones"
        value={meta ? `~${fmtTok(meta.configTokens)} tok` : '—'}
        sub="settings + CLAUDE.md"
        sparkData={history} sparkKey="configTokens" color="#7d8590"
      />

      {/* Alertas */}
      <div style={S.alertsWrap}>
        <div style={{ ...S.label, marginBottom: 2 }}>
          {alerts.length > 0 ? `🔔 ${alerts.length} alerta${alerts.length > 1 ? 's' : ''}` : '🔔 Alertas'}
        </div>
        {alerts.length === 0 ? (
          <div style={S.noAlerts}>✓ Todo ok</div>
        ) : (
          alerts.slice(0, 3).map((a, i) => (
            <div key={i} style={S.alert(a.level)}>
              {a.level === 'critical' ? '🔴' : a.level === 'warning' ? '🟡' : '🔵'} {a.message}
            </div>
          ))
        )}
      </div>

    </div>
    </>
  )
}
