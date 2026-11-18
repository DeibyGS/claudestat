import type { LoopAlert, ErrorPersistenceAlert, SessionState } from '../types'
import { fmtDuration } from './shared'

;(function injectAttentionCss() {
  if (typeof document === 'undefined') return
  const id = 'ct-attention-css'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = `
.cs-att-card { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); flex-shrink: 0 }
.cs-att-h { font: 700 11px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); padding: 9px 12px; border-bottom: 1px solid var(--line) }
.cs-att-b { padding: 9px 12px; display: flex; flex-direction: column; gap: 7px }
.cs-alert { display: flex; gap: 8px; padding: 7px 9px; border-radius: 7px; font-size: 12px; align-items: flex-start }
.cs-alert.warn { background: var(--warn-soft); color: var(--warn) }
.cs-alert.crit { background: var(--crit-soft); color: var(--crit) }
.cs-alert.ok   { background: var(--ok-soft);   color: var(--ok) }
.cs-alert b { display: block; font-weight: 700; color: var(--text) }
.cs-alert p { margin: 0; color: var(--muted) }
`
  document.head.appendChild(s)
})()

interface Props {
  loops:            LoopAlert[]
  errorPersistence?: ErrorPersistenceAlert[]
  sessionState:     SessionState
  waitingSinceMs?:  number
}

export function AttentionCard({ loops, errorPersistence = [], sessionState, waitingSinceMs }: Props) {
  const rows: { level: 'warn' | 'crit' | 'ok'; title: string; detail: string }[] = []

  for (const loop of loops) {
    rows.push({
      level: 'warn',
      title: `Posible loop: ${loop.toolName} ×${loop.count}`,
      detail: 'La misma herramienta se repite con la misma entrada sin avanzar.',
    })
  }
  for (const err of errorPersistence) {
    rows.push({
      level: 'crit',
      title: `Errores persistentes: ${err.toolName} ×${err.count}`,
      detail: err.error,
    })
  }
  if (sessionState === 'waiting_for_input' && waitingSinceMs) {
    rows.push({
      level: 'warn',
      title: `Esperando tu respuesta hace ${fmtDuration(waitingSinceMs)}`,
      detail: 'La sesión no avanza hasta que contestes.',
    })
  }

  return (
    <div className="cs-att-card">
      <div className="cs-att-h">Atención</div>
      <div className="cs-att-b">
        {rows.length === 0 ? (
          <div className="cs-alert ok">
            <span>✓</span>
            <p><b>Todo en orden</b>Sin loops ni esperas.</p>
          </div>
        ) : rows.map((r, i) => (
          <div key={i} className={`cs-alert ${r.level}`}>
            <span>{r.level === 'ok' ? '✓' : '⚠'}</span>
            <p><b>{r.title}</b>{r.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
