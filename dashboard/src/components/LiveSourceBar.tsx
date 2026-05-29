import type { ActiveSource } from '../types'

export const SOURCE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'opencode':    'OpenCode',
  'codex':       'Codex',
  'amp':         'Amp',
  'droid':       'Droid',
  'codebuff':    'Codebuff',
}

function fmtCost(usd: number): string {
  return usd >= 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(5)}`
}

interface Props {
  sources:  ActiveSource[]
  active:   string
  onSelect: (source: string) => void
}

export function LiveSourceBar({ sources, active, onSelect }: Props) {
  if (sources.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 16px', borderBottom: '1px solid #21262d',
      background: '#0d1117', flexWrap: 'wrap',
    }}>
      {sources.map(s => {
        const isActive = s.source === active
        return (
          <button
            key={s.source}
            onClick={() => onSelect(s.source)}
            style={{
              display:     'flex', alignItems: 'center', gap: 6,
              padding:     '3px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize:    11, fontFamily: 'inherit',
              background:  isActive ? '#161b22' : 'transparent',
              border:      isActive ? '1px solid #1f6feb' : '1px solid #30363d',
              color:       isActive ? '#e6edf3' : '#8b949e',
              transition:  'all 0.15s',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#3fb950', display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontWeight: isActive ? 600 : 400 }}>
              {SOURCE_LABELS[s.source] ?? s.source}
            </span>
            {s.cost_usd > 0 && (
              <span style={{ color: '#7d8590', fontSize: 10 }}>
                {fmtCost(s.cost_usd)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface CardProps {
  source: ActiveSource
}

export function ActiveSourceCard({ source }: CardProps) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#8b949e', fontSize: 13,
    }}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
        padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 280,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#3fb950', display: 'inline-block',
          }} />
          <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 15 }}>
            {SOURCE_LABELS[source.source] ?? source.source}
          </span>
          <span style={{ color: '#7d8590', fontSize: 11 }}>active</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '4px 12px', fontSize: 12 }}>
          <span style={{ color: '#7d8590' }}>Session</span>
          <span style={{ color: '#e6edf3', fontFamily: 'monospace', fontSize: 11 }}>
            {source.sessionId.slice(0, 20)}…
          </span>
          <span style={{ color: '#7d8590' }}>Model</span>
          <span style={{ color: '#e6edf3' }}>{source.model}</span>
          {source.cost_usd > 0 && (
            <>
              <span style={{ color: '#7d8590' }}>Cost</span>
              <span style={{ color: '#3fb950', fontWeight: 600 }}>{fmtCost(source.cost_usd)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
