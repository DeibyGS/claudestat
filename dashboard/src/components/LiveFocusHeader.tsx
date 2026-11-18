import type { LiveSessionRow, SessionState } from '../types'
import { shortModel } from './shared'

;(function injectFocusHeaderCss() {
  if (typeof document === 'undefined') return
  const id = 'ct-focus-header-css'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = `
.cs-fhead { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; padding: 10px 24px 2px; flex-shrink: 0 }
.cs-fhead .cs-src-badge { font: 700 10px 'JetBrains Mono', monospace; padding: 2px 6px; border-radius: 4px; color: var(--panel); flex-shrink: 0 }
.cs-fhead .cs-src-badge.cc { background: var(--accent) }
.cs-fhead .cs-src-badge.oc { background: var(--ok) }
.cs-fhead h1 { font-size: 15px; font-weight: 700; margin: 0; color: var(--text) }
.cs-fhead .cs-state-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px }
.cs-fhead .cs-state-chip::before { content: ""; width: 6px; height: 6px; border-radius: 50% }
.cs-fhead .cs-state-chip.working { color: var(--ok); background: var(--ok-soft) }
.cs-fhead .cs-state-chip.working::before { background: var(--ok) }
.cs-fhead .cs-state-chip.waiting_for_input { color: var(--warn); background: var(--warn-soft) }
.cs-fhead .cs-state-chip.waiting_for_input::before { background: var(--warn) }
.cs-fhead .cs-state-chip.idle { color: var(--muted); background: var(--panel-2) }
.cs-fhead .cs-state-chip.idle::before { background: var(--muted) }
.cs-fhead .cs-chip { font: 600 11px 'JetBrains Mono', monospace; color: var(--muted); padding: 2px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel) }
`
  document.head.appendChild(s)
})()

const STATE_LABEL: Record<SessionState, string> = { working: 'trabajando', waiting_for_input: 'esperando', idle: 'inactiva' }

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface Props {
  row?:         LiveSessionRow
  sessionState: SessionState
  model?:       string
  startedAt?:   number
}

export function LiveFocusHeader({ row, sessionState, model, startedAt }: Props) {
  if (!row) return null
  const name = (row.project ?? '').replace(/\/+$/, '').split('/').pop() || row.sessionId.slice(0, 8)
  return (
    <div className="cs-fhead">
      <span className={`cs-src-badge ${row.source === 'opencode' ? 'oc' : 'cc'}`}>
        {row.source === 'opencode' ? 'OC' : 'CC'}
      </span>
      <h1>{name}</h1>
      <span className={`cs-state-chip ${sessionState}`}>{STATE_LABEL[sessionState]}</span>
      <span style={{ flex: 1 }} />
      {model && <span className="cs-chip">{shortModel(model)}</span>}
      {row.branch && <span className="cs-chip">⎇ {row.branch}</span>}
      {startedAt && <span className="cs-chip">desde {fmtTime(startedAt)}</span>}
    </div>
  )
}
