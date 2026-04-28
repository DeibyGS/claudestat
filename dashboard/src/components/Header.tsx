import { useEffect, useRef, useState } from 'react'
import { Radio, History, FolderGit2, FolderOpen, Zap, Settings2, Wrench, Layers, TrendingUp, type LucideIcon } from 'lucide-react'
import type { AppState, TraceEvent, QuotaData } from '../types'
import { Tip } from './Tip'

// Inject keyframes once (tooltip fade-in + tool pulse)
;(function injectKF() {
  if (typeof document === 'undefined') return
  const id = 'ct-header-kf'
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = [
    '@keyframes tipFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes toolBlink{0%,100%{opacity:1}50%{opacity:.5}}',
    '@keyframes livePulse{0%,100%{opacity:1}50%{opacity:.4}}',
  ].join('')
  document.head.appendChild(s)
})()

export type Tab = 'live' | 'history' | 'projects' | 'analytics' | 'system'

interface Props {
  state:          AppState
  connStatus:     'idle' | 'connected' | 'error'
  activeTab:      Tab
  onTabChange:    (t: Tab) => void
  activeProject:  string | null
  onOpenConfig:   () => void
  quota?:         QuotaData
}

const CONN_LABEL: Record<string, string> = {
  idle:      '○ Starting',
  connected: '● Connected',
  error:     '● Daemon down',
}
const CONN_COLOR: Record<string, string> = {
  idle:      '#8b949e',
  connected: '#3fb950',
  error:     '#f85149',
}

const TAB_LABELS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'live',      label: 'Live',      icon: Radio      },
  { id: 'history',   label: 'History',   icon: History    },
  { id: 'projects',  label: 'Projects',  icon: FolderGit2 },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp  },
  { id: 'system',    label: 'System',    icon: Layers     },
]

function fmtUptime(startedAt: number): string {
  const ms = Date.now() - startedAt
  if (ms < 60_000)  return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

function fmtReset(ms: number): string {
  if (ms <= 0) return 'now'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtCost(usd: number): string {
  if (usd < 0.001)  return `$${usd.toFixed(4)}`
  if (usd < 0.10)   return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

const S = {
  header: {
    background: '#161b22',
    borderBottom: '1px solid #21262d',
    padding: '0 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    height: 48,
    flexShrink: 0,
  } as React.CSSProperties,

  /* Brand */
  brand: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginRight: 4, flexShrink: 0,
  } as React.CSSProperties,
  dot: (connected: boolean, status?: string): React.CSSProperties => ({
    width: 7, height: 7, borderRadius: '50%',
    background: connected ? '#3fb950' : '#6e7681',
    flexShrink: 0,
    boxShadow: connected ? '0 0 5px #3fb950' : undefined,
  }),
  brandName: {
    color: '#e6edf3', fontWeight: 700, fontSize: 13,
    letterSpacing: '-0.2px',
  } as React.CSSProperties,

  sep: {
    width: 1, height: 20, background: '#21262d',
    margin: '0 12px', flexShrink: 0,
  } as React.CSSProperties,

  /* Tabs */
  tabs: {
    display: 'flex', alignItems: 'stretch',
    height: '100%',
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 12px',
    fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? '#e6edf3' : '#6e7681',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
    transition: 'color 0.15s',
  } as any),

  spacer: { flex: 1 } as React.CSSProperties,

  /* Right section */
  right: {
    display: 'flex', alignItems: 'center', gap: 8,
    flexShrink: 0,
  } as React.CSSProperties,
  metaBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: '#21262d', border: '1px solid #30363d',
    borderRadius: 5, padding: '2px 8px',
    fontSize: 11, fontWeight: 500, color: '#8b949e',
    flexShrink: 0,
  } as React.CSSProperties,
  projectBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    color: '#79c0ff', background: '#79c0ff12',
    border: '1px solid #79c0ff25',
    borderRadius: 5, padding: '2px 8px',
    fontSize: 11, fontWeight: 600, flexShrink: 0,
  } as React.CSSProperties,
  costBadge: (usd: number): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    color: usd > 1 ? '#f85149' : usd > 0.1 ? '#d29922' : '#3fb950',
    background: '#21262d', border: '1px solid #30363d',
    borderRadius: 5, padding: '2px 8px',
    fontSize: 11, fontWeight: 600, flexShrink: 0,
  }),
  ctxBar: (color: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: '#21262d', border: `1px solid ${color}44`,
    borderRadius: 5, padding: '2px 8px',
    fontSize: 11, fontWeight: 600, color,
    flexShrink: 0,
  }),
  disconnected: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: '#f8514920', border: '1px solid #f8514940',
    borderRadius: 5, padding: '2px 8px',
    fontSize: 11, fontWeight: 600, color: '#f85149',
  } as React.CSSProperties,
}

function ContextBadge({ remaining, contextPct, color }: { remaining: number; contextPct: number; color: string }) {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      style={{
        ...S.ctxBar(color),
        position: 'relative',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ContextBar pct={contextPct} color={color} />
      ~{remaining}% free

      {hovered && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 200,
          background: '#161b22',
          border: `1px solid ${color}44`,
          borderRadius: 7,
          padding: '10px 13px',
          minWidth: 220,
          maxWidth: 280,
          boxShadow: '0 8px 24px #00000066',
          pointerEvents: 'none',
          animation: 'tipFadeIn 0.15s ease forwards',
        }}>
          {/* Valor principal */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            <span style={{ color, fontWeight: 700, fontSize: 20 }}>~{remaining}%</span>
            <span style={{ color: '#7d8590', fontSize: 11 }}>context free</span>
          </div>

          {/* Barra grande */}
          <div style={{ height: 5, background: '#30363d', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{
              width: `${contextPct}%`, height: '100%',
              background: color, borderRadius: 3,
              boxShadow: `0 0 6px ${color}88`,
              transition: 'width 0.5s ease',
            }} />
          </div>

          {/* Nota */}
          <div style={{ color: '#484f58', fontSize: 10, lineHeight: 1.5 }}>
            Calculated based on the auto-compact threshold (~85% of total window).
            Matches "X% until auto-compact" shown in Claude Code terminal.
          </div>
        </div>
      )}
    </span>
  )
}

// Tip re-exported from shared component — see Tip.tsx

export function Header({ state, connStatus, activeTab, onTabChange, activeProject, onOpenConfig, quota }: Props) {
  const connected = connStatus === 'connected'
  const { sessionId, cost, startedAt } = state

  // C.14 — tool activo: último tool_start sin tool_end correspondiente
  const activeTool = (state.sessionState === 'working' && state.events?.length)
    ? (() => {
        for (let i = state.events.length - 1; i >= 0; i--) {
          const e = state.events[i] as TraceEvent
          if ((e as any).type === 'tool_end')   break
          if ((e as any).type === 'tool_start') return (e as any).tool_name as string | null
        }
        return null
      })()
    : null

  const projectName = activeProject ? activeProject.split('/').at(-1) : null
  const hasSession  = Boolean(sessionId)
  const costUsd     = cost?.cost_usd ?? 0
  const modelLabel  = fmtModel(cost?.model)

  return (
    <div style={S.header}>
      {/* Brand */}
      <Tip align="left" content={
        <div>
          <div style={{ color: CONN_COLOR[connStatus], fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {CONN_LABEL[connStatus]}
          </div>
          <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
            {connStatus === 'error'
              ? <>Daemon not responding — retrying...<br />Check: <code>claudestat start</code></>
              : <>Daemon listening on localhost:7337<br />Real-time data via SSE</>
            }
          </div>
        </div>
      }>
        <div style={S.brand}>
          <div style={{ ...S.dot(connected), background: CONN_COLOR[connStatus], boxShadow: connected ? `0 0 5px ${CONN_COLOR[connStatus]}` : undefined }} />
          <span style={S.brandName}>claudestat</span>
        </div>
      </Tip>

      <div style={S.sep} />

      {/* Tabs */}
      <div style={S.tabs}>
        {TAB_LABELS.map(({ id, label, icon: Icon }) => (
          <button key={id} style={S.tab(activeTab === id)} onClick={() => onTabChange(id)}>
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div style={S.spacer} />

      {/* Right section */}
      <div style={S.right}>

        {/* Modelo activo */}
        {modelLabel && (
          <Tip content={
            <div>
              <div style={{ color: modelLabel.color, fontWeight: 700, fontSize: 13, marginBottom: 5 }}>
                {modelLabel.name}
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4, fontFamily: 'monospace' }}>
                {cost?.model}
              </div>
              <div style={{ color: '#7d8590', fontSize: 10 }}>
                Active model in current session
              </div>
            </div>
          }>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: modelLabel.bg, border: `1px solid ${modelLabel.color}30`,
              borderRadius: 5, padding: '2px 8px',
              fontSize: 11, fontWeight: 600, color: modelLabel.color,
              flexShrink: 0, cursor: 'default',
            }}>
              {modelLabel.name}
            </span>
          </Tip>
        )}

        {/* Haiku en uso (sub-agentes) */}
        {quota && quota.weeklyHoursHaiku > 0 && (
          <Tip content={
            <div>
              <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 13, marginBottom: 5 }}>Haiku active</div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                {quota.weeklyHoursHaiku.toFixed(1)}h used this week<br />
                Running in sub-agents (code-explorer, devops…)
              </div>
            </div>
          }>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#3fb95012', border: '1px solid #3fb95025',
              borderRadius: 5, padding: '2px 8px',
              fontSize: 11, fontWeight: 600, color: '#3fb95099',
              flexShrink: 0, cursor: 'default',
            }}>
              Haiku
            </span>
          </Tip>
        )}

        {/* Proyecto activo */}
        {projectName && (
          <Tip content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#79c0ff', marginBottom: 4 }}>Active project</div>
              <div style={{ color: '#7d8590' }}>Working directory detected by claudestat</div>
              <div style={{ color: '#484f58', marginTop: 6, fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>
                {activeProject}
              </div>
            </div>
          }>
            <span style={S.projectBadge}>
              <FolderOpen size={11} />
              {projectName}
            </span>
          </Tip>
        )}

        {/* Costo de sesión (solo si hay sesión activa y costo > 0) */}
        {hasSession && costUsd > 0 && (
          <Tip content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18, marginBottom: 5 }}>
                {fmtCost(costUsd)}
              </div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                Accumulated cost of the current session.<br />
                Only includes usage from Claude Code,<br />
                not from claude.ai web.
              </div>
            </div>
          }>
            <span style={{ ...S.costBadge(costUsd), cursor: 'default' }}>
              {fmtCost(costUsd)}
            </span>
          </Tip>
        )}

        {/* Uptime de sesión */}
        {hasSession && startedAt > 0 && (
          <Tip content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18, marginBottom: 5 }}>
                {fmtUptime(startedAt)}
              </div>
              <div style={{ color: '#7d8590', fontSize: 10 }}>
                Start: {new Date(startedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          }>
            <UptimeBadge startedAt={startedAt} />
          </Tip>
        )}

        {/* Tool activo (C.14) */}
        {activeTool && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: '#d2992215', border: '1px solid #d2992235',
            borderRadius: 5, padding: '2px 8px',
            fontSize: 11, fontWeight: 600, color: '#d29922',
            animation: 'toolBlink 1.8s ease-in-out infinite',
            flexShrink: 0,
          }}>
            <Wrench size={10} />
            {activeTool}
          </span>
        )}

        {/* Desconectado */}
        {!connected && (
          <span style={S.disconnected}>
            <Zap size={11} />
            disconnected
          </span>
        )}

        {/* Settings button */}
        <button
          onClick={onOpenConfig}
          title="Settings"
          style={{
            display: 'flex', alignItems: 'center',
            background: 'none', border: '1px solid transparent',
            borderRadius: 5, padding: '3px 6px',
            cursor: 'pointer', color: '#6e7681',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e6edf3'; e.currentTarget.style.borderColor = '#30363d' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; e.currentTarget.style.borderColor = 'transparent' }}
        >
          <Settings2 size={14} />
        </button>

      </div>
    </div>
  )
}

/** Badge de uptime que se actualiza cada minuto */
function UptimeBadge({ startedAt }: { startedAt: number }) {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceUpdate(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: '#21262d', border: '1px solid #30363d',
      borderRadius: 5, padding: '2px 8px',
      fontSize: 11, fontWeight: 500, color: '#8b949e',
    }} title="Current session duration">
      {fmtUptime(startedAt)}
    </span>
  )
}

function fmtModel(model?: string): { name: string; color: string; bg: string } | null {
  if (!model) return null
  if (model.includes('opus'))   return { name: 'Opus 4.6',   color: '#d29922', bg: '#d2992212' }
  if (model.includes('haiku'))  return { name: 'Haiku 4.5',  color: '#3fb950', bg: '#3fb95012' }
  if (model.includes('sonnet')) return { name: 'Sonnet 4.6', color: '#58a6ff', bg: '#58a6ff12' }
  // Fallback: recortar a "claude-X-Y" → "X Y"
  const parts = model.replace('claude-', '').split('-').slice(0, 2).join(' ')
  return { name: parts || model, color: '#8b949e', bg: '#8b949e12' }
}

function ContextBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: 48, height: 4, background: '#30363d', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%', background: color,
        borderRadius: 2, transition: 'width 0.5s ease',
      }} />
    </div>
  )
}

