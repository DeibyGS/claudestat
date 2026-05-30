import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, WifiOff, Zap, TrendingUp } from 'lucide-react'
import type {
  AppState, TraceEvent, CostInfo, BlockCost,
  MetaStats, MetaSnapshot, DaySessions, ProjectSummary,
  QuotaData, SessionState, ClaudeStatsData, QuotaStats, SubAgentSession,
  ActiveSource
} from './types'
import type { SystemConfig } from './components/SystemView'
import { type Tab, Header }    from './components/Header'
import { ConfigPanel }        from './components/ConfigPanel'
import { TracePanel }          from './components/TracePanel'
import { LiveSourceBar, SOURCE_LABELS } from './components/LiveSourceBar'

const HistoryView  = lazy(() => import('./components/HistoryView').then(m => ({ default: m.HistoryView })))
const ProjectsView = lazy(() => import('./components/ProjectsView').then(m => ({ default: m.ProjectsView })))
const AnalyticsView = lazy(() => import('./components/AnalyticsView').then(m => ({ default: m.AnalyticsView })))
const TopView      = lazy(() => import('./components/TopView').then(m => ({ default: m.TopView })))
const SystemView   = lazy(() => import('./components/SystemView').then(m => ({ default: m.SystemView })))

const HEAVY_BLOCK_THRESHOLD = 500_000
const MAX_EVENTS = 10_000

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
  const [activeSources,    setActiveSources]    = useState<ActiveSource[]>([])
  const [activeLiveSource, setActiveLiveSource] = useState<string>('claude-code')
  const [opencodeEvents,   setOpencodeEvents]   = useState<TraceEvent[]>([])
  const [opencodePrompts,  setOpencodePrompts]  = useState<Array<{ index: number; ts: number; text: string }>>([])
  const [claudeCodeEvents,  setClaudeCodeEvents]  = useState<TraceEvent[]>([])
  const [claudeCodePrompts, setClaudeCodePrompts] = useState<Array<{ index: number; ts: number; text: string }>>([])
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

  // ── Todos los eventos históricos: cargar cuando cambia la sesión ─────────────
  useEffect(() => {
    if (!state.sessionId) return
    fetch(`/api/session-events?session_id=${state.sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.events?.length) return
        setState(prev => prev.sessionId === state.sessionId
          ? { ...prev, events: d.events }
          : prev
        )
      })
      .catch(() => {})
  }, [state.sessionId])

  // ── Prompts: cargar cuando cambia la sesión ────────────────────────────────
  useEffect(() => {
    if (!state.sessionId) return
    fetch(`/prompts?session_id=${state.sessionId}`)
      .then(r => r.json())
      .then(d => setPrompts(d.prompts ?? []))
      .catch(() => {})
  }, [state.sessionId])

  // ── Consolidated slow polling (60s): hidden-cost, claude-stats, projects ────
  useEffect(() => {
    function fetchSlowData() {
      fetch('/hidden-cost').then(r => r.ok ? r.json() : null).then(d => d && setHiddenCost(d)).catch(() => {})
      fetch('/claude-stats').then(r => r.ok ? r.json() : null).then(d => d && setClaudeStats(d)).catch(() => {})
      fetch('/projects').then(r => r.json()).then(d => {
        setProjects(d.projects ?? [])
        setActiveProject(d.active_project ?? null)
      }).catch(() => {})
    }
    fetchSlowData()
    const t = setInterval(fetchSlowData, 60_000)
    return () => clearInterval(t)
  }, [])

  // ── Consolidated fast polling (15s): meta-stats, quota ──────────────────────
  useEffect(() => {
    function fetchFastData() {
      fetch('/meta-stats').then(r => r.ok ? r.json() : null).then(d => {
        if (!d) return
        setMetaStats(d.current)
        setMetaHistory(d.history ?? [])
      }).catch(() => {})
      fetch('/quota').then(r => r.ok ? r.json() : null).then(d => d && setQuota(d)).catch(() => {})
    }
    fetchFastData()
    const t = setInterval(fetchFastData, 15_000)
    return () => clearInterval(t)
  }, [])

  // ── Active sources polling (10s) ────────────────────────────────────────────
  useEffect(() => {
    function fetchSources() {
      fetch('/api/active-sessions')
        .then(r => r.ok ? r.json() : null)
        .then((d: ActiveSource[] | null) => {
          if (!d) return
          setActiveSources(d)
          // Use functional updater to avoid stale closure on activeLiveSource
          setActiveLiveSource(prev => {
            if (d.find(s => s.source === prev)) return prev   // current source still active
            if (d.find(s => s.source === 'claude-code')) return 'claude-code'  // prefer claude-code
            return d[0]?.source ?? 'claude-code'              // fallback to first
          })
        })
        .catch(() => {})
    }
    fetchSources()
    const t = setInterval(fetchSources, 10_000)
    return () => clearInterval(t)
  }, [])

  // ── OpenCode events polling (10s when active) ───────────────────────────────
  // OC creates one session per prompt. We poll directly from OC's SQLite via
  // opencode-reader which groups sessions by directory (60s gap threshold raised to 5min).
  // Dep: ocSessionId — only restarts when the actual session changes, not on every
  // activeSources array reference update (which would cancel in-flight fetches every 10s).
  const ocSessionId = activeSources.find(s => s.source === activeLiveSource)?.sessionId
  useEffect(() => {
    if (!ocSessionId || activeLiveSource === 'claude-code') return
    // Clear stale events from previous session
    setOpencodeEvents([])
    setOpencodePrompts([])
    let cancelled = false
    function fetchEvents() {
      fetch(`/api/opencode/session/${ocSessionId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled) return
          if (d?.events) {
            setOpencodeEvents(() => {
              // Replace entirely each poll — reader returns the full session group
              const events = (d.events as TraceEvent[]).slice(-MAX_EVENTS)
              return events
            })
          }
          if (d?.prompts) {
            setOpencodePrompts(() => d.prompts)
          }
        })
        .catch(() => {})
    }
    fetchEvents()
    const t = setInterval(fetchEvents, 5_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [ocSessionId, activeLiveSource])

  // ── Claude Code events polling (10s when active) ────────────────────────────
  useEffect(() => {
    const src = activeSources.find(s => s.source === activeLiveSource)
    if (!src || activeLiveSource !== 'claude-code') return
    let cancelled = false
    function fetchEvents() {
      Promise.all([
        fetch(`/api/session-events?session_id=${src!.sessionId}`),
        fetch(`/prompts?session_id=${src!.sessionId}`),
      ])
        .then(([evtRes, prmRes]) => Promise.all([
          evtRes.ok ? evtRes.json() : null,
          prmRes.ok ? prmRes.json() : null,
        ]))
        .then(([evtData, prmData]) => {
          if (cancelled) return
          if (evtData?.events) setClaudeCodeEvents(evtData.events)
          if (prmData?.prompts) setClaudeCodePrompts(prmData.prompts)
        })
        .catch(() => {})
    }
    fetchEvents()
    const t = setInterval(fetchEvents, 10_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [activeLiveSource, activeSources])

  // ── Quota re-fetch on session state change ──────────────────────────────────
  useEffect(() => {
    fetch('/quota').then(r => r.ok ? r.json() : null).then(d => d && setQuota(d)).catch(() => {})
    fetch('/api/quota-stats').then(r => r.json()).then(setQuotaStats).catch(() => {})
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

  // ── Debounced project refresh on SSE events ─────────────────────────────────
  // Instead of fetching /projects on every event, debounce to once per 10s max
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch('/projects').then(r => r.json()).then(d => {
        setActiveProject(d.active_project ?? null)
      }).catch(() => {})
    }, 10_000)
    return () => clearTimeout(timer)
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
        activeSources={activeSources}
      />
      {configOpen && <ConfigPanel onClose={() => setConfigOpen(false)} />}

      {/* Alertas globales — visibles en cualquier pestaña */}
      {connStatus === 'error'  && <DisconnectedBanner />}
      {killSwitchActive        && <KillSwitchBanner />}

      {activeTab === 'live' && (
        <>
          {compacting && <CompactBanner />}
          {heavyBlockTokens !== null && <HeavyContextBanner tokens={heavyBlockTokens} />}
          <LiveSourceBar
            sources={activeSources}
            active={activeLiveSource}
            onSelect={setActiveLiveSource}
          />
          <div style={liveLayout}>
            {(() => {
              const isClaudeCode = activeLiveSource === 'claude-code'
              const activeSource = activeSources.find(s => s.source === activeLiveSource)
              const sourceCost: CostInfo | undefined = activeSource ? {
                cost_usd:         activeSource.cost_usd,
                input_tokens:     activeSource.input_tokens,
                output_tokens:    activeSource.output_tokens,
                cache_read:       activeSource.cache_read,
                cache_creation:   activeSource.cache_creation,
                efficiency_score: isClaudeCode ? (state.cost?.efficiency_score ?? 100) : 0,
                model:            activeSource.model,
                loops:            [],
                context_used:     isClaudeCode ? undefined : activeSource.input_tokens,
              } : undefined
              // Fallback to SSE state.events while polling hasn't loaded claudeCodeEvents yet
              const ccEvents = claudeCodeEvents.length > 0 ? claudeCodeEvents : state.events
              const ccLast   = ccEvents[ccEvents.length - 1]
              const ccState: SessionState = !ccLast ? 'idle'
                : Date.now() - ccLast.ts > 120_000 ? 'idle'
                : ccLast.type === 'PreToolUse' ? 'working' : 'waiting_for_input'
              const ocState: SessionState = !activeSource ? 'idle'
                : (Date.now() - activeSource.last_seen_ms) < 30_000 ? 'working'
                : (Date.now() - activeSource.last_seen_ms) < 60_000 ? 'waiting_for_input'
                : 'idle'
              return (
                <TracePanel
                  events={isClaudeCode ? ccEvents : opencodeEvents}
                  startedAt={isClaudeCode ? (ccEvents[0]?.ts ?? activeSource?.last_seen_ms ?? Date.now()) : (opencodeEvents[0]?.ts ?? activeSource?.last_seen_ms ?? Date.now())}
                  cost={sourceCost}
                  blockCosts={isClaudeCode ? state.blockCosts : []}
                  meta={isClaudeCode ? metaStats : undefined}
                  quota={isClaudeCode ? quota : undefined}
                  sessionState={isClaudeCode ? ccState : ocState}
                  weeklyData={state.weeklyData}
                  hiddenCost={isClaudeCode ? hiddenCost : undefined}
                  prompts={isClaudeCode ? claudeCodePrompts : opencodePrompts}
                  quotaStats={isClaudeCode ? quotaStats : undefined}
                  subAgentSessions={[]}
                  cliLabel={isClaudeCode ? 'Claude Code' : (activeSource ? (SOURCE_LABELS[activeSource.source] ?? activeSource.source) : 'Claude Code')}
                />
              )
            })()}
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <HistoryView days={historyDays} activeSessionId={state.sessionId} />
          </Suspense>
        </div>
      )}

      {activeTab === 'projects' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <ProjectsView projects={projects} activeProject={activeProject} weeklyData={state.weeklyData} />
          </Suspense>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <AnalyticsView quota={quota} cost={state.cost} events={[...claudeCodeEvents, ...opencodeEvents].sort((a, b) => a.ts - b.ts)} prompts={prompts} claudeStats={claudeStats} />
          </Suspense>
        </div>
      )}

      {activeTab === 'top' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <TopView />
          </Suspense>
        </div>
      )}

      {activeTab === 'system' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <SystemView config={systemConfig} error={systemConfigError} onRetry={fetchSystemConfig} />
          </Suspense>
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
      source: p.source,
      started_at: p.started_at,
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
