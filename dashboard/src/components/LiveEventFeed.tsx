import type { TraceEvent } from '../types'

;(function injectFeedCss() {
  if (typeof document === 'undefined') return
  const id = 'ct-live-feed-css'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = `
.cs-feed-card { border-top: 1px solid var(--line); background: var(--panel); flex-shrink: 0; max-height: 200px; display: flex; flex-direction: column }
.cs-feed-h { font: 700 11px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); padding: 8px 24px; flex-shrink: 0 }
.cs-feed-b { overflow-y: auto; padding: 0 24px 8px; font: 12px 'JetBrains Mono', monospace }
.cs-ev { display: grid; grid-template-columns: 62px 28px 90px minmax(0,1fr) 52px; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--line); align-items: center }
.cs-ev:last-child { border-bottom: 0 }
.cs-ev .cs-ts, .cs-ev .cs-du { color: var(--faint) }
.cs-ev .cs-du { text-align: right }
.cs-ev .cs-ev-src { font-size: 9px; padding: 0 4px; text-align: center; border-radius: 3px; color: var(--panel); font-weight: 700 }
.cs-ev .cs-ev-src.cc { background: var(--accent) }
.cs-ev .cs-ev-src.oc { background: var(--ok) }
.cs-ev .cs-tool { font-weight: 700; color: var(--text) }
.cs-ev .cs-in { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cs-feed-empty { color: var(--faint); font-size: 12px; padding: 8px 0 }
`
  document.head.appendChild(s)
})()

export type FeedEvent = TraceEvent & { _src: 'cc' | 'oc' }

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface Props {
  events: FeedEvent[]
  limit?: number
}

export function LiveEventFeed({ events, limit = 40 }: Props) {
  const rows = events
    .filter(e => e.tool_name)
    .slice(0, limit)

  return (
    <div className="cs-feed-card">
      <div className="cs-feed-h">Eventos · todas las sesiones</div>
      <div className="cs-feed-b">
        {rows.length === 0 ? (
          <div className="cs-feed-empty">Sin actividad reciente</div>
        ) : rows.map((e, i) => (
          <div className="cs-ev" key={`${e.session_id ?? ''}-${e.ts}-${i}`}>
            <span className="cs-ts">{fmtTime(e.ts)}</span>
            <span className={`cs-ev-src ${e._src}`}>{e._src.toUpperCase()}</span>
            <span className="cs-tool">{e.tool_name}</span>
            <span className="cs-in">{e.tool_input ?? e.text_preview ?? ''}</span>
            <span className="cs-du">{e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
