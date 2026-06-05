import { lazy, Suspense, useCallback, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import { AlertTriangle, WifiOff, Zap, TrendingUp } from 'lucide-react'
import type {
  AppState, TraceEvent, CostInfo, BlockCost, DailyActivity,
  MetaStats, MetaSnapshot, DaySessions, ProjectSummary,
  QuotaData, SessionState, ClaudeStatsData, QuotaStats, SubAgentSession,
  ActiveSource, ToolStatus, OrchTimeline
} from './types'
import type { SystemConfig } from './components/SystemView'
import { type Tab, Header }    from './components/Header'
import { ConfigPanel }        from './components/ConfigPanel'
import { TracePanel }          from './components/TracePanel'
import { LiveSourceBar, SOURCE_LABELS } from './components/LiveSourceBar'
import { fmtTok } from './components/shared'

const HistoryView  = lazy(() => import('./components/HistoryView').then(m => ({ default: m.HistoryView })))
const ProjectsView = lazy(() => import('./components/ProjectsView').then(m => ({ default: m.ProjectsView })))
const AnalyticsView = lazy(() => import('./components/AnalyticsView').then(m => ({ default: m.AnalyticsView })))
const TopView      = lazy(() => import('./components/TopView').then(m => ({ default: m.TopView })))
const SystemView   = lazy(() => import('./components/SystemView').then(m => ({ default: m.SystemView })))
const OrchestrateView = lazy(() => import('./components/OrchestrateView').then(m => ({ default: m.OrchestrateView })))

const HEAVY_BLOCK_THRESHOLD = 500_000
const STALE_SOURCE_MS = 5 * 60 * 1000
const MAX_EVENTS = 10_000


const EMPTY: AppState = {
  sessionId: '', cwd: '', startedAt: Date.now(), events: [], weeklyData: [],
  sessionState: 'idle', blockCosts: [], pendingBlockCost: null, subAgentSessions: []
}

class OrchErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(e: Error) { return { err: e.message } }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 24, color: '#f85149', fontFamily: 'monospace', fontSize: 12 }}>
        Orchestrator view crashed: {this.state.err}
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  const [state,        setState]       = useState<AppState>(EMPTY)
  // 'idle' = antes de conectar, 'connected' = SSE activo, 'error' = daemon caído
  const [connStatus,   setConnStatus]  = useState<'idle' | 'connected' | 'error'>('idle')
  const [activeTab,    setActiveTab]   = useState<Tab>('live')
  const [metaStats,    setMetaStats]   = useState<MetaStats | undefined>()
  const [metaHistory,  setMetaHistory] = useState<MetaSnapshot[]>([])
  const [historyDays,    setHistoryDays]    = useState<DaySessions[]>([])
  const [historyPeriod,  setHistoryPeriod]  = useState(30)
  const [projects,        setProjects]       = useState<ProjectSummary[]>([])
  const [activeProject,   setActiveProject]  = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
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
  const [activeLiveSessionId, setActiveLiveSessionId] = useState<string>('')
  const [toolStatus,       setToolStatus]       = useState<ToolStatus>({})
  const [activityData,    setActivityData]     = useState<DailyActivity[]>([])
  const [opencodeEvents,   setOpencodeEvents]   = useState<TraceEvent[]>([])
  const [opencodePrompts,  setOpencodePrompts]  = useState<Array<{ index: number; ts: number; text: string }>>([])
  const [claudeCodeEvents,  setClaudeCodeEvents]  = useState<TraceEvent[]>([])
  const [claudeCodePrompts, setClaudeCodePrompts] = useState<Array<{ index: number; ts: number; text: string }>>([])
  const [ocContextInfo, setOcContextInfo] = useState<{ context_used?: number; context_window?: number } | undefined>()
  const [orchData, setOrchData] = useState<OrchTimeline | null>(null)
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
          if (msg.type === 'cost_update' && msg.payload?.source === 'opencode') {
            const p = msg.payload
            if (p.context_used != null || p.context_window != null) {
              setOcContextInfo({ context_used: p.context_used, context_window: p.context_window })
            }
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
        setProjectsLoading(false)
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

  // ── Tool-status polling (5s) — estado real del orquestrador CC+OC ───────────
  useEffect(() => {
    function fetchToolStatus() {
      fetch('/tool-status')
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setToolStatus(d))
        .catch(() => {})
    }
    fetchToolStatus()
    const t = setInterval(fetchToolStatus, 5_000)
    return () => clearInterval(t)
  }, [])

  // ── Activity data polling (60s) — for heatmap ────────────────────────────────
  useEffect(() => {
    const fetchActivity = () =>
      fetch('/api/activity?days=365')
        .then(r => r.json())
        .then(setActivityData)
        .catch(() => {});
    fetchActivity();
    const id = setInterval(fetchActivity, 60000);
    return () => clearInterval(id);
  }, []);

  // ── Active sources polling (10s) ────────────────────────────────────────────
  useEffect(() => {
    function fetchSources() {
      fetch('/api/active-sessions')
        .then(r => r.ok ? r.json() : null)
        .then((d: ActiveSource[] | null) => {
          const sources = d ?? []
          setActiveSources(sources)
          if (sources.length > 0) {
            setActiveLiveSessionId(prev => {
              if (sources.find(s => s.sessionId === prev)) return prev
              const cc = sources.find(s => s.source === 'claude-code')
              return cc ? cc.sessionId : sources[0].sessionId
            })
          }
        })
        .catch(() => {})
    }
    fetchSources()
    const t = setInterval(fetchSources, 10_000)
    return () => clearInterval(t)
  }, [])

  // ── Orchestration polling (10s) — for filtering Live sessions ──────────────
  useEffect(() => {
    function fetchOrch() {
      fetch('/api/orchestration/timeline')
        .then(r => r.ok ? r.json() : null)
        .then((d: OrchTimeline | null) => setOrchData(d))
        .catch(() => {})
    }
    fetchOrch()
    const t = setInterval(fetchOrch, 10_000)
    return () => clearInterval(t)
  }, [])

  // ── OpenCode events polling (5s when active non-CC session) ─────────────────
  const orchProjectPath = orchData && (orchData.status === 'active' || orchData.status === 'paused') ? orchData.project_path : null
  const liveSources = activeSources.filter(s => !orchProjectPath || !s.project || s.project !== orchProjectPath)
  const freshSources = activeSources.filter(s => Date.now() - s.last_seen_ms < STALE_SOURCE_MS)
  const selectedSession = activeSources.find(s => s.sessionId === activeLiveSessionId)
  const isOcActive = selectedSession && selectedSession.source !== 'claude-code'
  const ocSessionId = selectedSession?.sessionId

  useEffect(() => {
    if (!ocSessionId || !isOcActive) return
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
  }, [ocSessionId, isOcActive])

  // ── Claude Code events polling (10s when active CC session) ─────────────────
  const ccSessionId = activeSources.find(s => s.sessionId === activeLiveSessionId && s.source === 'claude-code')?.sessionId

  useEffect(() => {
    if (!ccSessionId) return
    let cancelled = false
    function fetchEvents() {
      Promise.all([
        fetch(`/api/session-events?session_id=${ccSessionId}`),
        fetch(`/prompts?session_id=${ccSessionId}`),
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
  }, [ccSessionId])

  // ── Quota re-fetch on session state change ──────────────────────────────────
  useEffect(() => {
    fetch('/quota').then(r => r.ok ? r.json() : null).then(d => d && setQuota(d)).catch(() => {})
    fetch('/api/quota-stats').then(r => r.json()).then(setQuotaStats).catch(() => {})
  }, [state.sessionState])

  // ── Fetch por tab ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'history') {
      fetch(`/history?days=${historyPeriod}`).then(r => r.json()).then(d => setHistoryDays(d.days ?? [])).catch(() => {})
    }
    if (activeTab === 'projects') {
      fetch('/projects').then(r => r.json()).then(d => {
        setProjects(d.projects ?? [])
        setActiveProject(d.active_project ?? null)
        setProjectsLoading(false)
      }).catch(() => {})
    }
    if (activeTab === 'system') {
      fetchSystemConfig()
    }
  }, [activeTab, historyPeriod])

  // ── Debounced project refresh on SSE events ─────────────────────────────────
  // Instead of fetching /projects on every event, debounce to once per 10s max
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch('/projects').then(r => r.json()).then(d => {
        setProjects(d.projects ?? [])
        setActiveProject(d.active_project ?? null)
      }).catch(() => {})
    }, 10_000)
    return () => clearTimeout(timer)
  }, [state.events.length])

  const liveLayout: React.CSSProperties = {
    flex: 1, overflow: 'hidden', display: 'flex',
  }

  const lastBlock = state.blockCosts.at(-1)
  const ccHeavyTokens = lastBlock && lastBlock.inputTokens >= HEAVY_BLOCK_THRESHOLD ? lastBlock.inputTokens : null
  const ccHeavyCache = lastBlock && lastBlock.cacheRead != null && lastBlock.cacheRead >= HEAVY_BLOCK_THRESHOLD ? lastBlock.cacheRead : lastBlock && lastBlock.context_used != null && lastBlock.context_used >= HEAVY_BLOCK_THRESHOLD ? lastBlock.context_used : undefined
  const ocSource = freshSources.find(s => s.source === 'opencode')
  const ocHeavyTokens = ocSource && ocSource.input_tokens >= HEAVY_BLOCK_THRESHOLD ? ocSource.input_tokens : null
  const ocHeavyCache = ocSource && ocSource.cache_read >= HEAVY_BLOCK_THRESHOLD ? ocSource.cache_read : undefined

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
      {compacting && <CompactBanner />}
      {ccHeavyTokens !== null && <HeavyContextBanner source="claude-code" tokens={ccHeavyTokens} cacheTokens={ccHeavyCache} />}
      {ocHeavyTokens !== null && <HeavyContextBanner source="opencode" tokens={ocHeavyTokens} cacheTokens={ocHeavyCache} />}

      {activeTab === 'live' && (
        <>
          <LiveSourceBar
            sources={liveSources}
            active={activeLiveSessionId}
            onSelect={setActiveLiveSessionId}
            toolStatus={toolStatus}
          />
          <div style={{
            padding: '3px 16px', borderBottom: '1px solid #21262d',
            background: '#0d1117', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 10, color: '#484f58' }}>
              Real-time tool session — context, tokens, cost, tool calls
            </span>
            <span style={{ fontSize: 9, color: '#21262d' }}>|</span>
            <span style={{ fontSize: 9, color: '#30363d' }}>
              For spec-driven workflow coordination see <span style={{ color: '#58a6ff' }}>Orchestrator</span> tab
            </span>
          </div>
          <div style={liveLayout}>
            {(() => {
              const isClaudeCode = selectedSession?.source === 'claude-code'
              const sourceCost: CostInfo | undefined = selectedSession ? {
                cost_usd:             selectedSession.cost_usd,
                input_tokens:         selectedSession.input_tokens,
                output_tokens:        selectedSession.output_tokens,
                cache_read:           selectedSession.cache_read,
                cache_creation:       selectedSession.cache_creation,
                efficiency_score:     isClaudeCode ? (state.cost?.efficiency_score ?? 100) : -1,
                model:                selectedSession.model,
                loops:                isClaudeCode ? (state.cost?.loops ?? []) : [],
                context_used:         isClaudeCode ? state.cost?.context_used : ocContextInfo?.context_used,
                context_window:       isClaudeCode ? state.cost?.context_window : ocContextInfo?.context_window,
                projected_hourly_usd: isClaudeCode ? state.cost?.projected_hourly_usd : undefined,
              } : undefined
              const ocBurnRate = !isClaudeCode && selectedSession && opencodeEvents.length >= 2
                ? (() => {
                    const startTs = opencodeEvents[0].ts
                    const endTs   = opencodeEvents[opencodeEvents.length - 1].ts
                    const mins    = (endTs - startTs) / 60_000
                    if (mins < 2) return undefined
                    const total = selectedSession.input_tokens + selectedSession.output_tokens
                    return total > 0 ? Math.round(total / mins) : undefined
                  })()
                : undefined
              const ccEvents = claudeCodeEvents.length > 0 ? claudeCodeEvents : state.events
              const ccLast   = ccEvents[ccEvents.length - 1]
              const ccState: SessionState = !ccLast ? 'idle'
                : Date.now() - ccLast.ts > 120_000 ? 'idle'
                : ccLast.type === 'PreToolUse' ? 'working' : 'waiting_for_input'
              const ocToolStatus = selectedSession ? toolStatus[selectedSession.source] : undefined
              const ocState: SessionState = !selectedSession ? 'idle'
                : ocToolStatus?.status === 'working' ? 'working'
                : (Date.now() - selectedSession.last_seen_ms) < 30_000 ? 'working'
                : (Date.now() - selectedSession.last_seen_ms) < 60_000 ? 'waiting_for_input'
                : 'idle'
              return (
                <TracePanel
                  events={isClaudeCode ? ccEvents : opencodeEvents}
                  startedAt={isClaudeCode ? (ccEvents[0]?.ts ?? selectedSession?.last_seen_ms ?? Date.now()) : (opencodeEvents[0]?.ts ?? selectedSession?.last_seen_ms ?? Date.now())}
                  cost={sourceCost}
                  blockCosts={isClaudeCode ? state.blockCosts : []}
                  meta={isClaudeCode ? metaStats : undefined}
                  quota={isClaudeCode ? quota : undefined}
                  sessionState={isClaudeCode ? ccState : ocState}
                  weeklyData={isClaudeCode ? state.weeklyData : []}
                  hiddenCost={isClaudeCode ? hiddenCost : undefined}
                  prompts={isClaudeCode ? claudeCodePrompts : opencodePrompts}
                  quotaStats={isClaudeCode ? quotaStats : undefined}
                  subAgentSessions={isClaudeCode ? state.subAgentSessions : []}
                  cliLabel={isClaudeCode ? 'Claude Code' : (selectedSession ? (SOURCE_LABELS[selectedSession.source] ?? selectedSession.source) : 'Claude Code')}
                  burnRateTokensPerMin={isClaudeCode ? undefined : ocBurnRate}
                />
              )
            })()}
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <HistoryView days={historyDays} activeSessionId={state.sessionId} selectedDays={historyPeriod} onDaysChange={setHistoryPeriod} />
          </Suspense>
        </div>
      )}

      {activeTab === 'projects' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <ProjectsView projects={projects} activeProject={activeProject} weeklyData={state.weeklyData} loading={projectsLoading} />
          </Suspense>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <AnalyticsView quota={quota} cost={state.cost} events={[...claudeCodeEvents, ...opencodeEvents].sort((a, b) => a.ts - b.ts)} prompts={prompts} claudeStats={claudeStats} activityData={activityData} />
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

      {activeTab === 'orchestrator' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <OrchErrorBoundary>
            <Suspense fallback={null}>
              <OrchestrateView />
            </Suspense>
          </OrchErrorBoundary>
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
    const entry: BlockCost = { inputUsd: p.inputUsd, outputUsd: p.outputUsd, totalUsd: p.totalUsd, inputTokens: p.inputTokens ?? 0, outputTokens: p.outputTokens ?? 0, context_used: p.context_used, context_window: p.context_window }
    // Acumular sub-turnos del bloque en curso — se empuja a blockCosts al recibir Stop
    const pend = prev.pendingBlockCost
    const merged: BlockCost = pend ? {
      inputUsd:       pend.inputUsd     + entry.inputUsd,
      outputUsd:      pend.outputUsd    + entry.outputUsd,
      totalUsd:       pend.totalUsd     + entry.totalUsd,
      inputTokens:    pend.inputTokens  + entry.inputTokens,
      outputTokens:   pend.outputTokens + entry.outputTokens,
      context_used:   entry.context_used,   // keep latest — context grows monotonically
      context_window: entry.context_window,
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
const CompactBanner      = () => <AlertBanner icon={Zap}           color="#d29922" title="Claude Code is compacting context" subtitle="tool history is automatically summarized to free up space" />
const HeavyContextBanner = ({ source, tokens, cacheTokens }: { source: string; tokens: number; cacheTokens?: number }) =>
  <AlertBanner
    icon={TrendingUp}
    color="#a371f7"
    title={`${SOURCE_LABELS[source] ?? source} — Heavy context · ${fmtTok(tokens)} new${cacheTokens ? ` + ${fmtTok(cacheTokens)} cache` : ''}`}
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
