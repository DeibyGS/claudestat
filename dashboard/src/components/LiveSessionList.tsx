import type { LiveSessionRow } from '../types'
import { fmtCost } from './shared'

// Injected once (live-tab-v2 T7, S11/S10) — follows the same singleton pattern as
// Sidebar.tsx's injectShellCss, using the index.html design tokens.
;(function injectLiveListCss() {
  if (typeof document === 'undefined') return
  const id = 'ct-live-list-css'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = `
.cs-slist-wrap { width: 236px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 10px; overflow-y: auto; background: var(--panel) }
.cs-slist-label { font: 600 10px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); margin: 0 0 8px; padding: 0 2px }
.cs-slist { display: flex; flex-direction: column; gap: 6px }
.cs-srow { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center; padding: 8px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--ground); cursor: pointer; text-align: left; width: 100%; color: inherit; font: inherit }
.cs-srow:hover { border-color: var(--line-2) }
.cs-srow[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset }
.cs-srow.child { margin-left: 14px; width: calc(100% - 14px) }
.cs-srow .cs-src { font: 700 9.5px 'JetBrains Mono', monospace; padding: 1px 5px; border-radius: 3px; color: var(--panel); flex-shrink: 0 }
.cs-srow .cs-src.cc  { background: var(--accent) }
.cs-srow .cs-src.oc  { background: var(--ok) }
.cs-srow .cs-src.sub { background: var(--faint) }
.cs-srow .cs-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 12px }
.cs-srow .cs-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0 }
.cs-srow .cs-dot.working { background: var(--ok); box-shadow: 0 0 4px var(--ok) }
.cs-srow .cs-dot.waiting_for_input { background: var(--warn) }
.cs-srow .cs-dot.idle { background: var(--faint) }
.cs-srow .cs-meta { grid-column: 1 / -1; display: flex; gap: 7px; align-items: center; font-size: 11px; color: var(--muted) }
.cs-srow .cs-mini { flex: 1; height: 4px; border-radius: 2px; background: var(--panel-2); overflow: hidden }
.cs-srow .cs-mini i { display: block; height: 100%; background: var(--muted) }
.cs-srow .cs-warn { color: var(--warn) }
.cs-slist-empty { color: var(--faint); font-size: 12px; padding: 10px 6px }

@media (max-width: 900px) {
  .cs-slist-wrap { width: auto; max-width: none; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; overflow-y: hidden }
  .cs-slist { flex-direction: row }
  .cs-srow, .cs-srow.child { min-width: 190px; width: auto; margin-left: 0 }
}
`
  document.head.appendChild(s)
})()

function basename(p: string | null): string {
  if (!p) return ''
  const clean = p.replace(/\/+$/, '')
  const seg = clean.split('/').pop()
  return seg || clean
}

const SRC_LABEL: Record<string, string> = { 'claude-code': 'CC', opencode: 'OC' }

interface Props {
  rows:     LiveSessionRow[]
  active:   string
  onSelect: (sessionId: string) => void
}

export function LiveSessionList({ rows, active, onSelect }: Props) {
  const byId = new Map(rows.map(r => [r.sessionId, r]))
  const roots = rows.filter(r => !r.parentId || !byId.has(r.parentId))
  const childrenByParent = new Map<string, LiveSessionRow[]>()
  for (const r of rows) {
    if (!r.parentId || !byId.has(r.parentId)) continue
    const list = childrenByParent.get(r.parentId) ?? []
    list.push(r)
    childrenByParent.set(r.parentId, list)
  }

  // Depth-first flatten so a sub-agent's own sub-agent (any nesting depth) still
  // appears in the list instead of being silently dropped (code-review finding,
  // live-tab-v2 T7) — `visited` guards against a cyclical parentId chain.
  const ordered: { row: LiveSessionRow; isChild: boolean }[] = []
  const visited = new Set<string>()
  function visit(row: LiveSessionRow, isChild: boolean) {
    if (visited.has(row.sessionId)) return
    visited.add(row.sessionId)
    ordered.push({ row, isChild })
    for (const child of childrenByParent.get(row.sessionId) ?? []) visit(child, true)
  }
  for (const root of roots) visit(root, false)

  return (
    <div className="cs-slist-wrap" aria-label="Sesiones activas">
      <p className="cs-slist-label">Sesiones activas</p>
      {ordered.length === 0 ? (
        <div className="cs-slist-empty">Sin sesiones activas</div>
      ) : (
        <div className="cs-slist">
          {ordered.map(({ row, isChild }) => {
            const pct = row.context_used && row.context_window
              ? Math.min(100, Math.round(row.context_used / row.context_window * 100))
              : null
            const warn = (row.loops_detected ?? 0) > 0
            const srcClass = isChild ? 'sub' : row.source === 'opencode' ? 'oc' : 'cc'
            const srcLabel = isChild ? 'SUB' : SRC_LABEL[row.source] ?? row.source.slice(0, 2).toUpperCase()
            const name = basename(row.project) || row.sessionId.slice(0, 8)
            return (
              <button
                key={row.sessionId}
                type="button"
                className={`cs-srow${isChild ? ' child' : ''}`}
                aria-pressed={row.sessionId === active}
                onClick={() => onSelect(row.sessionId)}
                title={row.project ?? row.sessionId}
              >
                <span className={`cs-src ${srcClass}`}>{srcLabel}</span>
                <span className="cs-name">{name}</span>
                <span className={`cs-dot ${row.state}`} title={row.state} />
                <span className="cs-meta">
                  <span>{pct !== null ? `${pct}%` : '—'}</span>
                  {pct !== null && (
                    <span className="cs-mini"><i style={{ width: `${pct}%`, background: pct > 75 ? 'var(--warn)' : 'var(--muted)' }} /></span>
                  )}
                  <span>{fmtCost(row.cost_usd)}</span>
                  {warn && <span className="cs-warn">⚠</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
