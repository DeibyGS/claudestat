import type { AppState } from '../types'

interface Props { state: AppState; connected: boolean }

const S = {
  header: {
    background: '#161b22',
    borderBottom: '1px solid #21262d',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  } as React.CSSProperties,
  dot: (connected: boolean): React.CSSProperties => ({
    width: 8, height: 8, borderRadius: '50%',
    background: connected ? '#3fb950' : '#f85149',
    flexShrink: 0,
    boxShadow: connected ? '0 0 6px #3fb950' : undefined,
  }),
  title: { color: '#e6edf3', fontWeight: 700, fontSize: 14 } as React.CSSProperties,
  dim:   { color: '#7d8590', fontSize: 12 } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    background: color + '22', color, border: `1px solid ${color}55`,
    borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600,
  }),
  bar: { flex: 1 } as React.CSSProperties,
  contextWrap: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
}

export function Header({ state, connected }: Props) {
  const { sessionId, cwd, cost } = state
  const shortId = sessionId ? sessionId.slice(0, 8) : '—'

  const pct = cost?.context_used && cost.context_window
    ? Math.round(cost.context_used / cost.context_window * 100) : null
  const remaining = pct !== null ? 100 - pct : null

  const barColor = remaining === null ? '#3fb950'
    : remaining < 20 ? '#f85149'
    : remaining < 40 ? '#d29922'
    : '#3fb950'

  return (
    <div style={S.header}>
      <div style={S.dot(connected)} title={connected ? 'Conectado' : 'Desconectado'} />
      <span style={S.title}>● claudetrace</span>
      <span style={S.dim}>session: <span style={{ color: '#58a6ff' }}>{shortId}</span></span>
      {cwd && <span style={S.dim}>dir: <span style={{ color: '#79c0ff' }}>{cwd}</span></span>}

      <div style={S.bar} />

      {remaining !== null && (
        <div style={S.contextWrap}>
          <span style={S.dim}>auto-compact en:</span>
          <ContextBar pct={pct!} color={barColor} />
          <span style={{ ...S.badge(barColor) }}>{remaining}% restante</span>
          <span style={S.dim}>
            {fmtTok(cost!.context_used!)} / {fmtTok(cost!.context_window!)} tokens
          </span>
        </div>
      )}

      {!connected && <span style={S.badge('#f85149')}>desconectado</span>}
    </div>
  )
}

function ContextBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: 100, height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color,
        borderRadius: 3,
        transition: 'width 0.5s ease',
        boxShadow: `0 0 4px ${color}88`,
      }} />
    </div>
  )
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
