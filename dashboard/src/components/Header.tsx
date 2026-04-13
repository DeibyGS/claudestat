import type { AppState } from '../types'

export type Tab = 'live' | 'history' | 'projects'

interface Props {
  state:       AppState
  connected:   boolean
  activeTab:   Tab
  onTabChange: (t: Tab) => void
  activeProject: string | null
}

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: 'live',     label: '⚡ En vivo'   },
  { id: 'history',  label: '📅 Historial' },
  { id: 'projects', label: '📁 Proyectos' },
]

const S = {
  header: {
    background: '#161b22',
    borderBottom: '1px solid #21262d',
    padding: '0 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    height: 48,
  } as React.CSSProperties,
  dot: (connected: boolean): React.CSSProperties => ({
    width: 8, height: 8, borderRadius: '50%',
    background: connected ? '#3fb950' : '#f85149',
    flexShrink: 0, marginRight: 10,
    boxShadow: connected ? '0 0 6px #3fb950' : undefined,
  }),
  title: { color: '#e6edf3', fontWeight: 700, fontSize: 14, marginRight: 16 } as React.CSSProperties,
  projectBadge: {
    color: '#79c0ff', background: '#79c0ff18', border: '1px solid #79c0ff30',
    borderRadius: 5, padding: '2px 10px', fontSize: 11, fontWeight: 600,
    marginRight: 8,
  } as React.CSSProperties,
  sep: { width: 1, height: 24, background: '#21262d', margin: '0 12px' },
  tabs: { display: 'flex', alignItems: 'stretch', height: '100%', marginLeft: 4 },
  tab: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center',
    padding: '0 14px',
    fontSize: 12, fontWeight: active ? 700 : 400,
    color: active ? '#e6edf3' : '#7d8590',
    cursor: 'pointer',
    transition: 'color 0.15s',
    userSelect: 'none',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
  } as any),
  spacer: { flex: 1 },
  contextWrap: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  dim: { color: '#7d8590', fontSize: 11 } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    background: color + '22', color, border: `1px solid ${color}55`,
    borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600,
  }),
}

export function Header({ state, connected, activeTab, onTabChange, activeProject }: Props) {
  const { sessionId, cost } = state

  const pct       = cost?.context_used && cost.context_window
    ? Math.round(cost.context_used / cost.context_window * 100) : null
  const remaining = pct !== null ? 100 - pct : null
  const barColor  = remaining === null ? '#3fb950'
    : remaining < 20 ? '#f85149' : remaining < 40 ? '#d29922' : '#3fb950'

  const projectName = activeProject
    ? activeProject.split('/').at(-1)
    : null

  return (
    <div style={S.header}>
      <div style={S.dot(connected)} title={connected ? 'Conectado' : 'Desconectado'} />
      <span style={S.title}>● claudetrace</span>

      {projectName && (
        <span style={S.projectBadge}>📁 {projectName}</span>
      )}

      {sessionId && (
        <span style={{ ...S.dim, fontSize: 10 }}>
          session: <span style={{ color: '#58a6ff' }}>{sessionId.slice(0, 8)}</span>
        </span>
      )}

      {/* Tabs */}
      <div style={S.sep} />
      <div style={S.tabs}>
        {TAB_LABELS.map(({ id, label }) => (
          <button key={id} style={S.tab(activeTab === id)} onClick={() => onTabChange(id)}>
            {label}
          </button>
        ))}
      </div>

      <div style={S.spacer} />

      {/* Context bar (solo en live) */}
      {activeTab === 'live' && remaining !== null && (
        <div style={S.contextWrap}>
          <span style={S.dim}>contexto:</span>
          <ContextBar pct={pct!} color={barColor} />
          <span style={S.badge(barColor)}>{remaining}%</span>
        </div>
      )}

      {!connected && <span style={S.badge('#f85149')}>desconectado</span>}
    </div>
  )
}

function ContextBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: 80, height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%', background: color,
        borderRadius: 3, transition: 'width 0.5s ease',
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
