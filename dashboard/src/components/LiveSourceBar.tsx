import type { ActiveSource, ToolStatus } from '../types'

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
  sources:    ActiveSource[]
  active:     string
  onSelect:   (source: string) => void
  toolStatus?: ToolStatus
}

export function LiveSourceBar({ sources, active, onSelect, toolStatus = {} }: Props) {
  if (sources.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 16px', borderBottom: '1px solid #21262d',
      background: '#0d1117', flexWrap: 'wrap',
    }}>
      {sources.map(s => {
        const isActive   = s.source === active
        const ts         = toolStatus[s.source]
        const lastTask   = ts?.last_task ?? null
        const waitingFor = ts?.waiting_for ?? null
        const dotColor   = s.source === 'opencode' ? '#3fb950' : s.source === 'claude-code' ? '#58a6ff' : '#8b949e'
        return (
          <button
            key={s.source}
            onClick={() => onSelect(s.source)}
            style={{
              display:        'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              padding:        '4px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize:       11, fontFamily: 'inherit',
              background:     isActive ? '#161b22' : 'transparent',
              border:         isActive ? '1px solid #1f6feb' : '1px solid #30363d',
              color:          isActive ? '#e6edf3' : '#8b949e',
              transition:     'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: dotColor, display: 'inline-block', flexShrink: 0,
              }} />
              <span style={{ fontWeight: isActive ? 600 : 400 }}>
                {SOURCE_LABELS[s.source] ?? s.source}
              </span>
              {s.cost_usd > 0 && (
                <span style={{ color: '#7d8590', fontSize: 10 }}>
                  {fmtCost(s.cost_usd)}
                </span>
              )}
              {waitingFor && (
                <span style={{
                  fontSize: 9, color: '#d29922',
                  background: '#d2992220', border: '1px solid #d2992240',
                  borderRadius: 3, padding: '1px 4px',
                }}>
                  ⏳ {waitingFor}
                </span>
              )}
            </div>
            {lastTask && (
              <div style={{
                fontSize: 9, color: '#484f58',
                maxWidth: 240, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                paddingLeft: 12,
              }}>
                {lastTask}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

