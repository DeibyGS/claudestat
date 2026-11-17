import { Radio, History, FolderGit2, TrendingUp, Trophy, Workflow, Layers, type LucideIcon } from 'lucide-react'
import { Tip } from './Tip'

// Inject shell layout once — shared by Sidebar and QuotaStrip (S9/S10, live-tab-v2 T6)
;(function injectShellCss() {
  if (typeof document === 'undefined') return
  const id = 'ct-shell-css'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = `
.cs-app { display: grid; grid-template-columns: 188px 1fr; height: 100vh; overflow: hidden }
.cs-sidebar { border-right: 1px solid var(--line); background: var(--panel); padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex-shrink: 0 }
.cs-brand { display: flex; align-items: center; gap: 7px; padding: 2px 8px 12px; font-weight: 700; font-size: 13px; color: var(--text); flex-shrink: 0 }
.cs-brand .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0 }
.cs-group { font: 600 10px 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); padding: 12px 9px 4px; flex-shrink: 0 }
.cs-group:first-of-type { padding-top: 0 }
.cs-nav { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 6px; border: 0; background: none; cursor: pointer; text-align: left; color: var(--muted); font-size: 12px; width: 100%; flex-shrink: 0 }
.cs-nav svg { flex-shrink: 0 }
.cs-nav:hover { background: var(--panel-2); color: var(--text) }
.cs-nav[aria-current="page"] { background: var(--accent-soft); color: var(--accent); font-weight: 600 }
.cs-nav .badge { margin-left: auto; font: 600 10px 'JetBrains Mono', monospace; padding: 0 6px; border-radius: 9px; background: var(--panel-2); color: var(--muted) }
.cs-nav[aria-current="page"] .badge { background: var(--panel); color: var(--accent) }
.cs-side-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); font-size: 10px; color: var(--faint); flex-shrink: 0 }
.cs-main { min-width: 0; display: flex; flex-direction: column; overflow: hidden }

.cs-quota { flex-shrink: 0; background: var(--panel); border-bottom: 1px solid var(--line); padding: 7px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap }
.cs-q { display: flex; flex-direction: column; gap: 3px; min-width: 128px }
.cs-q-top { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--muted) }
.cs-q-top b { font: 700 11px 'JetBrains Mono', monospace; color: var(--text) }
.cs-meter { height: 5px; border-radius: 3px; background: var(--panel-2); overflow: hidden }
.cs-meter i { display: block; height: 100%; border-radius: 3px }
.cs-q-note { font-size: 11px; padding: 4px 9px; border-radius: 5px; background: var(--warn-soft); color: var(--warn); display: flex; gap: 5px; align-items: center; margin-left: auto }
.cs-plan { font: 700 10px 'JetBrains Mono', monospace; padding: 2px 7px; border: 1px solid var(--line-2); border-radius: 4px; color: var(--muted); flex-shrink: 0 }

@media (max-width: 900px) {
  .cs-app { grid-template-columns: 1fr; grid-template-rows: auto 1fr }
  .cs-sidebar { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 8px 10px; border-right: 0; border-bottom: 1px solid var(--line); align-items: center }
  .cs-brand { padding: 2px 10px 2px 2px }
  .cs-group, .cs-side-foot { display: none }
  .cs-nav .lbl { display: none }
  .cs-nav[aria-current="page"] .lbl { display: inline }
  .cs-quota { padding: 7px 12px }
  .cs-q-note { margin-left: 0 }
}
`
  document.head.appendChild(s)
})()

export type Tab = 'live' | 'history' | 'projects' | 'top' | 'analytics' | 'system' | 'orchestrator'
export const ALL_TABS: Tab[] = ['live', 'history', 'projects', 'top', 'analytics', 'system', 'orchestrator']

const CONN_LABEL: Record<string, string> = {
  idle:      '○ Starting',
  connected: '● Connected',
  error:     '● Daemon down',
}
const CONN_COLOR: Record<string, string> = {
  idle:      'var(--faint)',
  connected: 'var(--ok)',
  error:     'var(--crit)',
}

interface NavItem { id: Tab; label: string; icon: LucideIcon }
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: 'Ahora', items: [
    { id: 'live', label: 'En vivo', icon: Radio },
    { id: 'top',  label: 'Top',     icon: Trophy },
  ]},
  { group: 'Registro', items: [
    { id: 'history',   label: 'Historial', icon: History },
    { id: 'projects',  label: 'Proyectos', icon: FolderGit2 },
    { id: 'analytics', label: 'Analítica', icon: TrendingUp },
  ]},
  { group: 'Herramienta', items: [
    { id: 'orchestrator', label: 'Orchestrator', icon: Workflow },
    { id: 'system',       label: 'Sistema',       icon: Layers },
  ]},
]

interface Props {
  activeTab:    Tab
  onTabChange: (t: Tab) => void
  connStatus:  'idle' | 'connected' | 'error'
  liveCount?:  number
}

export function Sidebar({ activeTab, onTabChange, connStatus, liveCount = 0 }: Props) {
  return (
    <nav className="cs-sidebar" aria-label="Vistas">
      <Tip align="left" content={
        <div>
          <div style={{ color: CONN_COLOR[connStatus], fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {CONN_LABEL[connStatus]}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 10, lineHeight: 1.6 }}>
            {connStatus === 'error'
              ? <>Daemon not responding — retrying...<br />Check: <code>claudestat start</code></>
              : <>Daemon listening on localhost:7337<br />Real-time data via SSE</>
            }
          </div>
        </div>
      }>
        <div className="cs-brand">
          <span className="dot" style={{ background: CONN_COLOR[connStatus] }} />
          claudestat
        </div>
      </Tip>

      {NAV_GROUPS.map(({ group, items }) => (
        <div key={group}>
          <div className="cs-group">{group}</div>
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className="cs-nav"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => onTabChange(id)}
            >
              <Icon size={14} />
              <span className="lbl">{label}</span>
              {id === 'live' && liveCount > 0 && <span className="badge">{liveCount}</span>}
            </button>
          ))}
        </div>
      ))}

      <div className="cs-side-foot" style={{ color: CONN_COLOR[connStatus] }}>
        {CONN_LABEL[connStatus]}
      </div>
    </nav>
  )
}
