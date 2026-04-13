import type { SessionSummary } from '../types'

interface Props { session: SessionSummary; isActive?: boolean }

const MODE_LABEL: Record<string, string> = {
  directo: 'directo', agentes: '🤖 agentes',
  skills: '⚡ skills', 'agentes+skills': '🤖⚡ agentes+skills',
}
const MODE_COLOR: Record<string, string> = {
  directo: '#7d8590', agentes: '#d29922', skills: '#58a6ff', 'agentes+skills': '#d29922',
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const S = {
  card: (active: boolean): React.CSSProperties => ({
    background: active ? '#1c2128' : '#161b22',
    border: `1px solid ${active ? '#1f6feb' : '#21262d'}`,
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  }),
  row:  { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  name: { color: '#e6edf3', fontWeight: 700, fontSize: 13 },
  dim:  { color: '#7d8590', fontSize: 11 },
  badge: (color: string): React.CSSProperties => ({
    color, background: color + '18', border: `1px solid ${color}30`,
    borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600,
  }),
  tool: { color: '#58a6ff', fontSize: 11 } as React.CSSProperties,
  sep:  { color: '#21262d', userSelect: 'none' as const, fontSize: 11 },
}

export function SessionCard({ session: s, isActive }: Props) {
  const color  = MODE_COLOR[s.mode] ?? '#7d8590'
  const scoreColor = s.efficiency_score >= 90 ? '#3fb950'
    : s.efficiency_score >= 70 ? '#d29922' : '#f85149'

  return (
    <div style={S.card(!!isActive)}>
      {/* Línea 1: hora · duración · proyecto · modo */}
      <div style={S.row}>
        {isActive && <span style={{ color: '#3fb950', fontSize: 10 }}>● EN VIVO</span>}
        <span style={S.dim}>
          {fmtTime(s.started_at)} → {fmtTime(s.last_event_at)}
        </span>
        <span style={S.dim}>·</span>
        <span style={{ ...S.dim, fontWeight: 600 }}>{fmtDuration(s.duration_ms)}</span>
        {s.project_name && (
          <>
            <span style={S.sep}>│</span>
            <span style={{ color: '#79c0ff', fontSize: 11 }}>📁 {s.project_name}</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={S.badge(color)}>{MODE_LABEL[s.mode]}</span>
      </div>

      {/* Línea 2: coste · tokens · eficiencia · loops */}
      <div style={S.row}>
        <span style={S.badge('#3fb950')}>${s.total_cost_usd.toFixed(4)}</span>
        <span style={S.dim}>·</span>
        <span style={S.dim}>{fmtTok(s.total_tokens)} tok</span>
        <span style={S.sep}>│</span>
        <span style={S.badge(scoreColor)}>eficiencia {s.efficiency_score}/100</span>
        {s.loops_detected > 0 && (
          <span style={S.badge('#f85149')}>⚠ {s.loops_detected} loops</span>
        )}
        <span style={S.sep}>│</span>
        <span style={S.dim}>{s.done_count} tools</span>
      </div>

      {/* Línea 3: top tools */}
      {s.top_tools.length > 0 && (
        <div style={S.row}>
          <span style={S.dim}>top:</span>
          {s.top_tools.map((t, i) => (
            <span key={i} style={S.tool}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}
