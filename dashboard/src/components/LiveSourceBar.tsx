import type { ActiveSource, ToolStatus, ToolStatusEntry } from '../types'

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
  onSelect:   (sessionId: string) => void
  toolStatus?: ToolStatus
}

function sessionLabel(source: string, sessionId: string): string {
  const short = sessionId.length > 4 ? sessionId.slice(0, 4) : sessionId
  const name = SOURCE_LABELS[source] ?? source
  return `${name}·${short}`
}

function relativeTime(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 60)  return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

function deriveStatus(ts: ToolStatusEntry | undefined, lastSeenMs: number): { label: string; color: string } {
  if (ts?.waiting_for) return { label: `waiting · ${ts.waiting_for}`, color: '#d29922' }
  if (ts?.status === 'working') return { label: 'working', color: '#3fb950' }
  const sec = (Date.now() - lastSeenMs) / 1000
  if (sec < 90) return { label: 'active', color: '#3fb950' }
  return { label: `idle · ${relativeTime(lastSeenMs)}`, color: '#484f58' }
}

export function LiveSourceBar({ sources, active, onSelect, toolStatus = {} }: Props) {
  if (sources.length === 0) return null

  return (
    <>
    <style>{`@keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.6; transform: scale(1.5) } }`}</style>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 16px', borderBottom: '1px solid #21262d',
      background: '#0d1117', flexWrap: 'wrap',
    }}>
      {sources.map(s => {
        const isActive   = s.sessionId === active
        const ts         = toolStatus[s.source]
        const isWorking  = ts?.status === 'working'
        const lastTask   = isWorking ? (ts?.last_task ?? null) : null
        const dotColor   = s.source === 'opencode' ? '#3fb950' : s.source === 'claude-code' ? '#58a6ff' : '#8b949e'
        const label      = sessionLabel(s.source, s.sessionId)
        const derived    = deriveStatus(ts, s.last_seen_ms)
        return (
          <button
            key={s.sessionId}
            onClick={() => onSelect(s.sessionId)}
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
                ...(isWorking ? { animation: 'pulse-dot 1.4s ease-in-out infinite' } : {}),
              }} />
              <span style={{ fontWeight: isActive ? 600 : 400 }}>
                {label}
              </span>
              {s.cost_usd > 0 && (
                <span style={{ color: '#7d8590', fontSize: 10 }}>
                  {fmtCost(s.cost_usd)}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 9, paddingLeft: 12,
              color: derived.color,
              maxWidth: 240, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {lastTask ?? derived.label}
            </div>
          </button>
        )
      })}
    </div>
    </>
  )
}

