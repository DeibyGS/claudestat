import { useEffect, useRef, useState } from 'react'
import { Radio, History, FolderGit2, FolderOpen, Zap, Settings2, Wrench, Timer, BarChart2, type LucideIcon } from 'lucide-react'
import type { AppState, TraceEvent, QuotaData } from '../types'

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

export type Tab = 'live' | 'history' | 'projects' | 'usage'

interface Props {
  state:          AppState
  connected:      boolean
  activeTab:      Tab
  onTabChange:    (t: Tab) => void
  activeProject:  string | null
  onOpenConfig:   () => void
  quota?:         QuotaData
}

const TAB_LABELS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'live',     label: 'En vivo',   icon: Radio      },
  { id: 'history',  label: 'Historial', icon: History    },
  { id: 'projects', label: 'Proyectos', icon: FolderGit2 },
  { id: 'usage',    label: 'Uso',       icon: BarChart2  },
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
  if (ms <= 0) return 'ahora'
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
  dot: (connected: boolean): React.CSSProperties => ({
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
      ~{remaining}% libre

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
            <span style={{ color: '#7d8590', fontSize: 11 }}>contexto libre</span>
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
            Calculado sobre el umbral de auto-compact (~85% de la ventana total).
            Se alinea con "X% until auto-compact" del terminal de Claude Code.
          </div>
        </div>
      )}
    </span>
  )
}

function Tip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 200,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 7,
          padding: '10px 13px',
          minWidth: 180,
          maxWidth: 260,
          boxShadow: '0 8px 24px #00000066',
          pointerEvents: 'none',
          animation: 'tipFadeIn 0.15s ease forwards',
        }}>
          {content}
        </div>
      )}
    </span>
  )
}

export function Header({ state, connected, activeTab, onTabChange, activeProject, onOpenConfig, quota }: Props) {
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

  // Umbral real de auto-compact de Claude Code ≈ 85% de la ventana total.
  // Calculamos el % usado sobre ese umbral para alinearnos con lo que muestra Claude.
  const COMPACT_THRESHOLD = 0.85
  const contextPct = cost?.context_used && cost.context_window
    ? Math.min(100, Math.round(cost.context_used / (cost.context_window * COMPACT_THRESHOLD) * 100)) : null
  const remaining = contextPct !== null ? 100 - contextPct : null
  const ctxColor  = remaining === null ? '#3fb950'
    : remaining < 20 ? '#f85149' : remaining < 40 ? '#d29922' : '#3fb950'

  const projectName = activeProject ? activeProject.split('/').at(-1) : null
  const hasSession  = Boolean(sessionId)
  const costUsd     = cost?.cost_usd ?? 0
  const modelLabel  = fmtModel(cost?.model)

  return (
    <div style={S.header}>
      {/* Brand */}
      <Tip content={
        <div>
          <div style={{ color: connected ? '#3fb950' : '#f85149', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {connected ? '● Conectado' : '● Desconectado'}
          </div>
          <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
            Daemon escuchando en localhost:7337<br />
            Datos en tiempo real vía SSE
          </div>
        </div>
      }>
        <div style={S.brand}>
          <div style={S.dot(connected)} />
          <span style={S.brandName}>claudetrace</span>
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
                Modelo activo en la sesión actual
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
              <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 13, marginBottom: 5 }}>Haiku activo</div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                {quota.weeklyHoursHaiku.toFixed(1)}h usadas esta semana<br />
                Corre en sub-agentes (code-explorer, devops…)
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

        {/* Cuota del ciclo 5h */}
        {quota && (
          <Tip content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 13, marginBottom: 5 }}>
                Plan {quota.detectedPlan === 'pro' ? 'Pro' : quota.detectedPlan === 'max5' ? 'Max 5×' : quota.detectedPlan === 'max20' ? 'Max 20×' : 'Free'}
                <span style={{ color: '#484f58', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>(auto-detectado)</span>
              </div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.7 }}>
                {quota.cyclePrompts} / {quota.cycleLimit} prompts en los últimos 5h<br />
                Reset en {fmtReset(quota.cycleResetAt ? quota.cycleResetAt - Date.now() : quota.cycleResetMs)}<br />
                <span style={{ color: '#3d444d' }}>El plan se infiere del máximo histórico de prompts/ciclo</span>
              </div>
              <div style={{ marginTop: 8, height: 4, background: '#30363d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(quota.cyclePct, 100)}%`, height: '100%',
                  background: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#3fb950',
                  borderRadius: 2, transition: 'width 0.5s',
                }} />
              </div>
            </div>
          }>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#21262d', border: '1px solid #30363d',
              borderRadius: 5, padding: '2px 8px',
              fontSize: 11, fontWeight: 600,
              color: quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#7d8590',
              flexShrink: 0, cursor: 'default',
            }}>
              <Timer size={10} />
              {quota.cyclePct}% · {fmtReset(quota.cycleResetAt ? quota.cycleResetAt - Date.now() : quota.cycleResetMs)}
            </span>
          </Tip>
        )}

        {/* Proyecto activo */}
        {projectName && (
          <span style={S.projectBadge}>
            <FolderOpen size={11} />
            {projectName}
          </span>
        )}

        {/* Costo de sesión (solo si hay sesión activa y costo > 0) */}
        {hasSession && costUsd > 0 && (
          <Tip content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18, marginBottom: 5 }}>
                {fmtCost(costUsd)}
              </div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                Costo acumulado de la sesión actual.<br />
                Solo incluye uso desde Claude Code,<br />
                no desde claude.ai web.
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
                Inicio: {new Date(startedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          }>
            <UptimeBadge startedAt={startedAt} />
          </Tip>
        )}

        {/* Contexto restante (solo en live) */}
        {activeTab === 'live' && remaining !== null && (
          <ContextBadge
            remaining={remaining}
            contextPct={contextPct!}
            color={ctxColor}
          />
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
            desconectado
          </span>
        )}

        {/* Botón configuración */}
        <button
          onClick={onOpenConfig}
          title="Configuración"
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
    }} title="Duración de la sesión actual">
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

