import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, WifiOff, Zap, TrendingUp } from 'lucide-react'
import type {
  AppState, TraceEvent, CostInfo, BlockCost,
  MetaStats, MetaSnapshot, DaySessions, ProjectSummary,
  QuotaData, SessionState, ClaudeStatsData, QuotaStats, SubAgentSession
} from './types'
import { type Tab, Header }    from './components/Header'
import { ConfigPanel }        from './components/ConfigPanel'
import { TracePanel }          from './components/TracePanel'
import { HistoryView }         from './components/HistoryView'
import { ProjectsView }        from './components/ProjectsView'
import { AnalyticsView }      from './components/AnalyticsView'
import { SystemView, type SystemConfig } from './components/SystemView'

const HEAVY_BLOCK_THRESHOLD = 500_000

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const EMPTY: AppState = {
  sessionId: '', cwd: '', startedAt: Date.now(), events: [], weeklyData: [],
  sessionState: 'idle', blockCosts: [], pendingBlockCost: null, subAgentSessions: []
}

export default function App() {
  const [state,        setState]       = useState<AppState>(EMPTY)
  // 'idle' = antes de conectar, 'connected' = SSE activo, 'error' = daemon caído
  const [connStatus,   setConnStatus]  = useState<'idle' | 'connected' | 'error'>('idle')
  const [activeTab,    setActiveTab]   = useState<Tab>('live')
  const [metaStats,    setMetaStats]   = useState<MetaStats | undefined>()
  const [metaHistory,  setMetaHistory] = useState<MetaSnapshot[]>([])
  const [historyDays,  setHistoryDays] = useState<DaySessions[]>([])
  const [projects,     setProjects]    = useState<ProjectSummary[]>([])
  const [activeProject,setActiveProject] = useState<string | null>(null)
  const [compacting,      setCompacting]     = useState(false)
  const [killSwitchActive, setKillSwitchActive] = useState(false)
  const [quota,        setQuota]       = useState<QuotaData | undefined>()
  const [configOpen,   setConfigOpen]  = useState(false)
  const [hiddenCost,   setHiddenCost]  = useState<{
    loop_waste_usd: number; total_cost_usd: number
    loop_sessions:  number; total_loops:    number; total_sessions: number
  } | undefined>()
  const [prompts,      setPrompts]     = useState<Array<{ index: number; ts: number; text: string }>>([]);
  const [claudeStats,  setClaudeStats] = useState<ClaudeStatsData | undefined>()
  const [systemConfig,      setSystemConfig]      = useState<SystemConfig | undefined>()
  const [systemConfigError, setSystemConfigError] = useState(false)
  const [quotaStats,   setQuotaStats]  = useState<QuotaStats | undefined>()
  const stateRef = useRef(state)
  stateRef.current = state

  const fetchSystemConfig = useCallback(() => {
    setSystemConfigError(false)
    fetch('/system-config')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setSystemConfig(d))
      .catch(() => setSystemConfigError(true))
  }, [])

  // ── Título dinámico del browser tab ───────────────────────────────────────
  useEffect(() => {
    const events = state.events
    // El último PreToolUse sin Done posterior = tool en progreso
    const last = [...events].reverse().find(e => e.type === 'PreToolUse' || e.type === 'Done' || e.type === 'Stop')
    if (last?.type === 'PreToolUse' && last.tool_name) {
      let label = last.tool_name.toLowerCase()
      if (last.tool_input) {
        try {
          const inp = JSON.parse(last.tool_input)
          const det = inp.file_path ? inp.file_path.split('/').pop()
            : inp.command ? inp.command.slice(0, 30)
            : inp.pattern ? inp.pattern.slice(0, 30)
            : null
          if (det) label += ` ${det}`
        } catch {}
      }
      document.title = `claudestat — ${label}`
    } else {
      document.title = 'claudestat'
    }
  }, [state.events])

  // ── Notificaciones del sistema ────────────────────────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // ── SSE stream ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource
    let retryTimer: ReturnType<typeof setTimeout>
    function connect() {
      es = new EventSource('/stream')
      es.addEventListener('open', () => setConnStatus('connected'))
      es.addEventListener('message', (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data)

          // Kill switch — guard evita renders cuando el estado no cambia
          if (msg.type === 'quota_warning') {
            const blocked = !!msg.payload?.blocked
            setKillSwitchActive(prev => prev === blocked ? prev : blocked)
          }

          // Notificaciones del sistema
          if ('Notification' in window && Notification.permission === 'granted') {
            if (msg.type === 'quota_warning' && (msg.payload?.level === 'orange' || msg.payload?.level === 'red')) {
              new Notification('claudestat — High Quota', {
                body: `Quota at ${msg.payload.cyclePct}% — ${msg.payload.level === 'red' ? 'Kill switch imminent' : 'Attention required'}`,
              })
            }
            if (msg.type === 'compact_detected') {
              new Notification('claudestat — Auto-compact', {
                body: 'Claude is compacting the session context',
              })
            }
          }

          if (msg.type === 'compact_detected') {
            setCompacting(true)
            setTimeout(() => setCompacting(false), 15_000)
            // Limpiar contexto: tras compactación el dato anterior ya no es válido.
            // El siguiente cost_update traerá el valor real post-compact.
            setState(prev => prev.cost
              ? { ...prev, cost: { ...prev.cost, context_used: undefined, context_window: undefined } }
              : prev
            )
            return
          }
          setState(prev => handleMessage(prev, msg))
        } catch {}
      })
      es.addEventListener('error', () => {
        setConnStatus('error'); es.close()
        retryTimer = setTimeout(connect, 2000)
      })
    }
    connect()
    return () => { es?.close(); clearTimeout(retryTimer) }
  }, [])

  useEffect(() => {
    fetch('/api/quota-stats').then(r => r.json()).then(setQuotaStats).catch(() => {})
  }, [])

  // ── Prompts: cargar cuando cambia la sesión ────────────────────────────────
  useEffect(() => {
    if (!state.sessionId) return
    fetch(`/prompts?session_id=${state.sessionId}`)
      .then(r => r.json())
      .then(d => setPrompts(d.prompts ?? []))
      .catch(() => {})
  }, [state.sessionId])

  // ── Hidden cost polling (cada 5 min) ───────────────────────────────────────
  useEffect(() => {
    async function fetchHiddenCost() {
      try {
        const r = await fetch('/hidden-cost')
        if (!r.ok) return
        setHiddenCost(await r.json())
      } catch {}
    }
    fetchHiddenCost()
    const t = setInterval(fetchHiddenCost, 5 * 60_000)
    return () => clearInterval(t)
  }, [])

  // ── Claude stats polling (stats-cache.json, cada 60s) ─────────────────────
  useEffect(() => {
    async function fetchClaudeStats() {
      try {
        const r = await fetch('/claude-stats')
        if (!r.ok) return
        setClaudeStats(await r.json())
      } catch {}
    }
    fetchClaudeStats()
    const t = setInterval(fetchClaudeStats, 60_000)
    return () => clearInterval(t)
  }, [])

  // ── Meta-stats polling ──────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchMeta() {
      try {
        const r = await fetch('/meta-stats')
        if (!r.ok) return
        const d = await r.json()
        setMetaStats(d.current)
        setMetaHistory(d.history ?? [])
      } catch {}
    }
    fetchMeta()
    const t = setInterval(fetchMeta, 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Quota polling (cada 30s + al cambiar de estado de sesión) ───────────────
  useEffect(() => {
    async function fetchQuota() {
      try {
        const r = await fetch('/quota')
        if (!r.ok) return
        setQuota(await r.json())
      } catch {}
    }
    fetchQuota()
    const t = setInterval(fetchQuota, 30_000)
    return () => clearInterval(t)
  }, [state.sessionState])

  // ── Fetch por tab ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'history') {
      fetch('/history').then(r => r.json()).then(d => setHistoryDays(d.days ?? [])).catch(() => {})
    }
    if (activeTab === 'projects') {
      fetch('/projects').then(r => r.json()).then(d => {
        setProjects(d.projects ?? [])
        setActiveProject(d.active_project ?? null)
      }).catch(() => {})
    }
    if (activeTab === 'system') {
      fetchSystemConfig()
    }
  }, [activeTab])

  // ── Projects: carga inicial + auto-refresh (60s) ────────────────────────────
  // Carga al montar para que el tab Proyectos muestre datos inmediatamente,
  // sin esperar a que el usuario lo abra por primera vez.
  useEffect(() => {
    function fetchProjects() {
      fetch('/projects').then(r => r.json()).then(d => {
        setProjects(d.projects ?? [])
        setActiveProject(d.active_project ?? null)
      }).catch(() => {})
    }
    fetchProjects()
    const t = setInterval(fetchProjects, 60_000)
    return () => clearInterval(t)
  }, [])

  // Actualizar active project cuando llega nuevo evento
  useEffect(() => {
    fetch('/projects').then(r => r.json()).then(d => {
      setActiveProject(d.active_project ?? null)
    }).catch(() => {})
  }, [state.events.length])

  const liveLayout: React.CSSProperties = {
    flex: 1, overflow: 'hidden', display: 'flex',
  }

  const lastBlock = state.blockCosts.at(-1)
  const heavyBlockTokens = lastBlock && lastBlock.inputTokens >= HEAVY_BLOCK_THRESHOLD ? lastBlock.inputTokens : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        state={state} connStatus={connStatus}
        activeTab={activeTab} onTabChange={setActiveTab}
        activeProject={activeProject}
        onOpenConfig={() => setConfigOpen(true)}
        quota={quota}
      />
      {configOpen && <ConfigPanel onClose={() => setConfigOpen(false)} />}

      {/* Alertas globales — visibles en cualquier pestaña */}
      {connStatus === 'error'  && <DisconnectedBanner />}
      {killSwitchActive        && <KillSwitchBanner />}

      {activeTab === 'live' && (
        <>
          {compacting && <CompactBanner />}
          {heavyBlockTokens !== null && <HeavyContextBanner tokens={heavyBlockTokens} />}
          <div style={liveLayout}>
            <TracePanel
              events={state.events} startedAt={state.startedAt}
              cost={state.cost} blockCosts={state.blockCosts}
              meta={metaStats} quota={quota}
              sessionState={state.sessionState}
              weeklyData={state.weeklyData}
              hiddenCost={hiddenCost}
              prompts={prompts}
              quotaStats={quotaStats}
              subAgentSessions={state.subAgentSessions}
            />
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <HistoryView days={historyDays} activeSessionId={state.sessionId} />
        </div>
      )}

      {activeTab === 'projects' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ProjectsView projects={projects} activeProject={activeProject} weeklyData={state.weeklyData} />
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AnalyticsView quota={quota} cost={state.cost} events={state.events} prompts={prompts} claudeStats={claudeStats} />
        </div>
      )}

      {activeTab === 'system' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SystemView config={systemConfig} error={systemConfigError} onRetry={fetchSystemConfig} />
        </div>
      )}

    </div>
  )
}

// ─── Reducer de mensajes SSE ───────────────────────────────────────────────────

function handleMessage(prev: AppState, msg: any): AppState {
  if (msg.type === 'init') {
    if (!msg.session) return prev
    const s = msg.session
    return {
      ...prev,
      sessionId:        s.id, cwd: s.cwd || '',
      startedAt:        s.started_at,
      events:           (msg.events || []) as TraceEvent[],
      cost:             buildCost(s),
      sessionState:     (s.state as SessionState) ?? 'idle',
      blockCosts:        (msg.blockCosts || []) as BlockCost[],
      subAgentSessions:  (msg.subAgentSessions || []) as SubAgentSession[],
      pendingBlockCost:  null,
    }
  }
  if (msg.type === 'state_change') {
    const p = msg.payload
    if (p.session_id !== prev.sessionId) return prev
    return { ...prev, sessionState: p.state as SessionState }
  }
  if (msg.type === 'event') {
    const evt = msg.payload as TraceEvent & { session_id: string }
    if (evt.session_id && evt.session_id !== prev.sessionId && prev.sessionId !== '') {
      return { ...prev, sessionId: evt.session_id, cwd: evt.cwd || '', startedAt: evt.ts, events: [], blockCosts: [], pendingBlockCost: null }
    }
    const MAX_EVENTS = 500
    let events = [...prev.events]
    if (evt.type === 'Done' && evt.tool_name) {
      const idx = [...events].reverse().findIndex(e => e.type === 'PreToolUse' && e.tool_name === evt.tool_name)
      if (idx !== -1) {
        const ri = events.length - 1 - idx
        events[ri] = { ...events[ri], type: 'Done', duration_ms: evt.ts - events[ri].ts }
      }
    } else {
      events = [...events, evt]
    }
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS)
    const next: AppState = { ...prev, events }
    if (!prev.sessionId && evt.session_id) {
      next.sessionId = evt.session_id; next.cwd = evt.cwd || ''; next.startedAt = evt.ts
    }
    // Stop = fin de bloque: guardar coste acumulado y resetear pendiente
    if (evt.type === 'Stop' && prev.pendingBlockCost) {
      next.blockCosts       = [...prev.blockCosts, prev.pendingBlockCost]
      next.pendingBlockCost = null
    }
    return next
  }
  if (msg.type === 'cost_update') {
    const p = msg.payload
    if (p.session_id !== prev.sessionId) return prev
    const cost: CostInfo = {
      cost_usd: p.cost_usd, input_tokens: p.input_tokens,
      output_tokens: p.output_tokens, cache_read: p.cache_read,
      cache_creation: p.cache_creation, efficiency_score: p.efficiency_score,
      context_used: p.context_used, context_window: p.context_window,
      loops: p.loops || [], summary: p.summary,
      model: p.model,
      projected_hourly_usd: p.projected_hourly_usd,
    }
    return { ...prev, cost }
  }
  if (msg.type === 'block_cost') {
    const p = msg.payload
    if (p.session_id !== prev.sessionId) return prev
    const entry: BlockCost = { inputUsd: p.inputUsd, outputUsd: p.outputUsd, totalUsd: p.totalUsd, inputTokens: p.inputTokens ?? 0, outputTokens: p.outputTokens ?? 0 }
    // Acumular sub-turnos del bloque en curso — se empuja a blockCosts al recibir Stop
    const pend = prev.pendingBlockCost
    const merged: BlockCost = pend ? {
      inputUsd:     pend.inputUsd     + entry.inputUsd,
      outputUsd:    pend.outputUsd    + entry.outputUsd,
      totalUsd:     pend.totalUsd     + entry.totalUsd,
      inputTokens:  pend.inputTokens  + entry.inputTokens,
      outputTokens: pend.outputTokens + entry.outputTokens,
    } : entry
    return { ...prev, pendingBlockCost: merged }
  }
  // summary_ready — el daemon generó un resumen IA para la sesión activa
  // Refrescamos el historial en el próximo render (el usuario lo verá al abrir History)
  if (msg.type === 'summary_ready') return prev  // no-op aquí, historia se refresca al cambiar tab
  return prev
}

// ─── Banners de alerta ────────────────────────────────────────────────────────

function AlertBanner({ icon: Icon, color, title, subtitle, action }: {
  icon:     React.ElementType
  color:    string
  title:    string
  subtitle: string
  action?:  { label: string; onClick: () => void }
}) {
  return (
    <div style={{
      background: '#161b22', borderBottom: `1px solid ${color}55`,
      padding: '6px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 10, overflow: 'hidden',
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <Icon size={14} color={color} style={{ flexShrink: 0 }} />
      <span style={{ color, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ color: '#7d8590', fontSize: 11, whiteSpace: 'nowrap' }}>— {subtitle}</span>
      {action && (
        <button onClick={action.onClick} style={{
          marginLeft: 6, padding: '2px 10px', fontSize: 11, fontWeight: 600,
          color, background: `${color}22`, border: `1px solid ${color}66`,
          borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {action.label}
        </button>
      )}
    </div>
  )
}

const DisconnectedBanner = () => <AlertBanner icon={WifiOff}       color="#f0883e" title="Daemon disconnected"      subtitle="reconnecting automatically…" />
const KillSwitchBanner   = () => <AlertBanner icon={AlertTriangle} color="#f85149" title="Kill switch active"      subtitle="5h quota exceeded · new tool calls blocked" />
const CompactBanner      = () => <AlertBanner icon={Zap}           color="#d29922" title="Claude is compacting context" subtitle="tool history is automatically summarized to free up space" />
const HeavyContextBanner = ({ tokens }: { tokens: number }) =>
  <AlertBanner
    icon={TrendingUp}
    color="#a371f7"
    title={`Heavy context · ${fmtTok(tokens)} tokens input`}
    subtitle="save important context before compacting"
    action={{ label: 'Copy /checkpoint', onClick: () => navigator.clipboard.writeText('/checkpoint') }}
  />

function buildCost(session: any): CostInfo | undefined {
  if (!session?.total_cost_usd) return undefined
  return {
    cost_usd: session.total_cost_usd ?? 0, input_tokens: session.total_input_tokens ?? 0,
    output_tokens: session.total_output_tokens ?? 0, cache_read: session.total_cache_read ?? 0,
    cache_creation: session.total_cache_creation ?? 0, efficiency_score: session.efficiency_score ?? 100,
    loops: [],
  }
}
