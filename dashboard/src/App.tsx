import { useEffect, useRef, useState } from 'react'
import type {
  AppState, TraceEvent, CostInfo,
  MetaStats, MetaSnapshot, DaySessions, ProjectSummary,
  QuotaData, SessionState
} from './types'
import { type Tab, Header }    from './components/Header'
import { KPIBar }              from './components/KPIBar'
import { TracePanel }          from './components/TracePanel'
import { DAGView }             from './components/DAGView'
import { StatsFooter }         from './components/StatsFooter'
import { HistoryView }         from './components/HistoryView'
import { ProjectsView }        from './components/ProjectsView'

const EMPTY: AppState = {
  sessionId: '', cwd: '', startedAt: Date.now(), events: [], weeklyData: [], sessionState: 'idle'
}

export default function App() {
  const [state,        setState]       = useState<AppState>(EMPTY)
  const [connected,    setConnected]   = useState(false)
  const [activeTab,    setActiveTab]   = useState<Tab>('live')
  const [metaStats,    setMetaStats]   = useState<MetaStats | undefined>()
  const [metaHistory,  setMetaHistory] = useState<MetaSnapshot[]>([])
  const [historyDays,  setHistoryDays] = useState<DaySessions[]>([])
  const [projects,     setProjects]    = useState<ProjectSummary[]>([])
  const [activeProject,setActiveProject] = useState<string | null>(null)
  const [compacting,   setCompacting]  = useState(false)
  const [quota,        setQuota]       = useState<QuotaData | undefined>()
  const stateRef = useRef(state)
  stateRef.current = state

  // ── SSE stream ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource
    let retryTimer: ReturnType<typeof setTimeout>
    function connect() {
      es = new EventSource('/stream')
      es.addEventListener('open', () => setConnected(true))
      es.addEventListener('message', (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'compact_detected') {
            setCompacting(true)
            setTimeout(() => setCompacting(false), 15_000)
            return
          }
          setState(prev => handleMessage(prev, msg))
        } catch {}
      })
      es.addEventListener('error', () => {
        setConnected(false); es.close()
        retryTimer = setTimeout(connect, 2000)
      })
    }
    connect()
    return () => { es?.close(); clearTimeout(retryTimer) }
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
  }, [activeTab])

  // Actualizar active project cuando llega nuevo evento
  useEffect(() => {
    fetch('/projects').then(r => r.json()).then(d => {
      setActiveProject(d.active_project ?? null)
    }).catch(() => {})
  }, [state.events.length])

  const liveLayout: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '380px 1fr', overflow: 'hidden', flex: 1
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        state={state} connected={connected}
        activeTab={activeTab} onTabChange={setActiveTab}
        activeProject={activeProject}
      />

      {activeTab === 'live' && (
        <>
          <KPIBar meta={metaStats} history={metaHistory} cost={state.cost} quota={quota} sessionState={state.sessionState} />
          {compacting && <CompactBanner />}
          <div style={liveLayout}>
            <TracePanel events={state.events} startedAt={state.startedAt} cost={state.cost} />
            <DAGView    events={state.events} startedAt={state.startedAt} />
          </div>
          <StatsFooter cost={state.cost} weeklyData={state.weeklyData} />
        </>
      )}

      {activeTab === 'history' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <HistoryView days={historyDays} activeSessionId={state.sessionId} />
        </div>
      )}

      {activeTab === 'projects' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ProjectsView projects={projects} activeProject={activeProject} />
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
      sessionId:    s.id, cwd: s.cwd || '',
      startedAt:    s.started_at,
      events:       (msg.events || []) as TraceEvent[],
      cost:         buildCost(s),
      sessionState: (s.state as SessionState) ?? 'idle',
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
      return { ...prev, sessionId: evt.session_id, cwd: evt.cwd || '', startedAt: evt.ts, events: [] }
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
    const next = { ...prev, events }
    if (!prev.sessionId && evt.session_id) {
      next.sessionId = evt.session_id; next.cwd = evt.cwd || ''; next.startedAt = evt.ts
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
    }
    return { ...prev, cost }
  }
  return prev
}

// ─── Banner de auto-compact ────────────────────────────────────────────────────

function CompactBanner() {
  return (
    <div style={{
      background: '#161b22',
      borderBottom: '1px solid #d2992255',
      padding: '6px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <span style={{ fontSize: 16 }}>⚡</span>
      <div>
        <span style={{ color: '#d29922', fontWeight: 700, fontSize: 12 }}>
          Claude está compactando el contexto
        </span>
        <span style={{ color: '#7d8590', fontSize: 11, marginLeft: 8 }}>
          — el historial de herramientas se resume automáticamente para liberar espacio
        </span>
      </div>
    </div>
  )
}

function buildCost(session: any): CostInfo | undefined {
  if (!session?.total_cost_usd) return undefined
  return {
    cost_usd: session.total_cost_usd ?? 0, input_tokens: session.total_input_tokens ?? 0,
    output_tokens: session.total_output_tokens ?? 0, cache_read: session.total_cache_read ?? 0,
    cache_creation: session.total_cache_creation ?? 0, efficiency_score: session.efficiency_score ?? 100,
    loops: [],
  }
}
