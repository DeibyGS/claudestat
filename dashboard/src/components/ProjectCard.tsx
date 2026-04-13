import type { ProjectSummary, ModelUsage } from '../types'

interface Props { project: ProjectSummary; isActive?: boolean }

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}
function relativeTime(ts: number | null) {
  if (!ts) return 'nunca'
  const diff = Date.now() - ts
  if (diff < 60_000)          return 'ahora mismo'
  if (diff < 3_600_000)       return `hace ${Math.round(diff/60_000)}m`
  if (diff < 86_400_000)      return `hace ${Math.round(diff/3_600_000)}h`
  if (diff < 7 * 86_400_000)  return `hace ${Math.round(diff/86_400_000)}d`
  return new Date(ts).toLocaleDateString('es', { day:'numeric', month:'short' })
}

/** Barra horizontal de uso por modelo */
function ModelUsageBars({ usage }: { usage: ModelUsage }) {
  const total = usage.opusTokens + usage.sonnetTokens + usage.haikuTokens
  if (total === 0) return null

  const bars: { label: string; tokens: number; color: string }[] = [
    { label: 'Sonnet', tokens: usage.sonnetTokens, color: '#58a6ff' },
    { label: 'Opus',   tokens: usage.opusTokens,   color: '#d29922' },
    { label: 'Haiku',  tokens: usage.haikuTokens,  color: '#3fb950' },
  ].filter(b => b.tokens > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ color: '#7d8590', fontSize: 10, marginBottom: 1 }}>uso por modelo</span>
      {/* Barra segmentada */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        {bars.map(b => (
          <div key={b.label} style={{
            height: '100%',
            width: `${Math.round(b.tokens / total * 100)}%`,
            background: b.color,
            minWidth: b.tokens > 0 ? 2 : 0,
          }} />
        ))}
      </div>
      {/* Leyenda */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {bars.map(b => (
          <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
            <span style={{ color: b.color, fontSize: 9, fontWeight: 700 }}>{b.label}</span>
            <span style={{ color: '#7d8590', fontSize: 9 }}>{fmtTok(b.tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const S = {
  card: (active: boolean): React.CSSProperties => ({
    background: active ? '#1c2128' : '#161b22',
    border: `1px solid ${active ? '#1f6feb' : '#21262d'}`,
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'default',
    transition: 'border-color 0.2s',
  }),
  header: { display: 'flex', alignItems: 'center', gap: 8 },
  name:   { color: '#e6edf3', fontWeight: 700, fontSize: 15, flex: 1 },
  activeBadge: {
    color: '#3fb950', background: '#3fb95018', border: '1px solid #3fb95030',
    borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700,
  } as React.CSSProperties,
  autoBadge: {
    color: '#7d8590', background: '#7d859015', border: '1px solid #7d859030',
    borderRadius: 4, padding: '1px 6px', fontSize: 9,
  } as React.CSSProperties,
  path: { color: '#7d8590', fontSize: 10, marginTop: -4 },

  progressWrap: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  progressRow:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel:{ color: '#7d8590', fontSize: 11 },
  progressPct:  (pct: number): React.CSSProperties => ({
    color: pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : '#7d8590',
    fontWeight: 700, fontSize: 12,
  }),
  barTrack: { height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' as const },
  barFill:  (pct: number): React.CSSProperties => ({
    height: '100%',
    width: `${pct}%`,
    background: pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : '#58a6ff',
    borderRadius: 3,
    transition: 'width 0.5s ease',
    boxShadow: `0 0 4px ${pct >= 80 ? '#3fb95088' : pct >= 50 ? '#d2992288' : '#58a6ff88'}`,
  }),
  nextTask: { color: '#7d8590', fontSize: 10, fontStyle: 'italic' as const },

  stats: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8, marginTop: 2,
  },
  stat: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  statVal: { color: '#e6edf3', fontWeight: 700, fontSize: 12 },
  statLbl: { color: '#7d8590', fontSize: 10 },
}

export function ProjectCard({ project: p, isActive }: Props) {
  // Detectar si el HANDOFF fue auto-generado por claudetrace
  const isAutoHandoff = p.has_handoff && p.progress.total === 0 &&
    p.progress.done === 0 && p.progress.nextTask === null

  return (
    <div style={S.card(!!isActive)}>
      {/* Nombre + path */}
      <div>
        <div style={S.header}>
          <span style={S.name}>📁 {p.name}</span>
          {isActive && <span style={S.activeBadge}>● activo</span>}
          {isAutoHandoff && <span style={S.autoBadge}>HANDOFF auto</span>}
        </div>
        <div style={S.path}>{p.path}</div>
      </div>

      {/* Progress (tareas del HANDOFF) */}
      {p.has_handoff ? (
        <div style={S.progressWrap}>
          {p.progress.total === 0 ? (
            <span style={{ ...S.progressLabel, fontStyle: 'italic' }}>
              {isAutoHandoff
                ? '→ HANDOFF auto-generado — completá las secciones con tus tareas'
                : 'sin tareas registradas'}
            </span>
          ) : p.progress.done === 0 ? (
            <>
              <span style={S.progressLabel}>
                {p.progress.total} tarea{p.progress.total > 1 ? 's' : ''} pendiente{p.progress.total > 1 ? 's' : ''}
              </span>
              {p.progress.nextTask && (
                <div style={S.nextTask}>→ próximo: {p.progress.nextTask}</div>
              )}
            </>
          ) : (
            <>
              <div style={S.progressRow}>
                <span style={S.progressLabel}>
                  {p.progress.done}/{p.progress.total} tareas
                </span>
                <span style={S.progressPct(p.progress.pct)}>{p.progress.pct}%</span>
              </div>
              <div style={S.barTrack}>
                <div style={S.barFill(p.progress.pct)} />
              </div>
              {p.progress.nextTask && (
                <div style={S.nextTask}>→ próximo: {p.progress.nextTask}</div>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Uso por modelo */}
      {p.model_usage && (
        <ModelUsageBars usage={p.model_usage} />
      )}

      {/* Stats: coste · tokens · sesiones · última actividad */}
      <div style={S.stats}>
        <div style={S.stat}>
          <span style={S.statVal}>${p.total_cost_usd.toFixed(2)}</span>
          <span style={S.statLbl}>coste total</span>
        </div>
        <div style={S.stat}>
          <span style={S.statVal}>{fmtTok(p.total_tokens)}</span>
          <span style={S.statLbl}>tokens</span>
        </div>
        <div style={S.stat}>
          <span style={S.statVal}>{p.session_count}</span>
          <span style={S.statLbl}>sesiones</span>
        </div>
        <div style={S.stat}>
          <span style={S.statVal}>{relativeTime(p.last_active)}</span>
          <span style={S.statLbl}>última vez</span>
        </div>
      </div>
    </div>
  )
}
