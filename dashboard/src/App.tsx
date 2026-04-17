import { useEffect, useRef, useState } from 'react'
import { Zap } from 'lucide-react'
import type {
  AppState, TraceEvent, CostInfo, BlockCost,
  MetaStats, MetaSnapshot, DaySessions, ProjectSummary,
  QuotaData, SessionState
} from './types'
import { type Tab, Header }    from './components/Header'
import { ConfigPanel }        from './components/ConfigPanel'
import { TracePanel }          from './components/TracePanel'
import { HistoryView }         from './components/HistoryView'
import { ProjectsView }        from './components/ProjectsView'
import { UsageView }           from './components/UsageView'

const EMPTY: AppState = {
  sessionId: '', cwd: '', startedAt: Date.now(), events: [], weeklyData: [], sessionState: 'idle', blockCosts: []
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
  const [configOpen,   setConfigOpen]  = useState(false)
  const [hiddenCost,   setHiddenCost]  = useState<{
    loop_waste_usd: number; total_cost_usd: number
    loop_sessions:  number; total_loops:    number; total_sessions: number
  } | undefined>()
  const [prompts,      setPrompts]     = useState<Array<{ index: number; ts: number; text: string }>>([]);
  const stateRef = useRef(state)
  stateRef.current = state

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
      document.title = `claudetrace — ${label}`
    } else {
      document.title = 'claudetrace'
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
      es.addEventListener('open', () => setConnected(true))
      es.addEventListener('message', (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data)

          // Notificaciones del sistema
          if ('Notification' in window && Notification.permission === 'granted') {
            if (msg.type === 'quota_warning' && (msg.payload?.level === 'orange' || msg.payload?.level === 'red')) {
              new Notification('claudetrace — Cuota alta', {
                body: `Cuota al ${msg.payload.cyclePct}% — ${msg.payload.level === 'red' ? 'Kill switch próximo' : 'Atención requerida'}`,
              })
            }
            if (msg.type === 'compact_detected') {
              new Notification('claudetrace — Auto-compact', {
                body: 'Claude está compactando el contexto de la sesión',
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
        setConnected(false); es.close()
        retryTimer = setTimeout(connect, 2000)
      })
    }
    connect()
    return () => { es?.close(); clearTimeout(retryTimer) }
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        state={state} connected={connected}
        activeTab={activeTab} onTabChange={setActiveTab}
        activeProject={activeProject}
        onOpenConfig={() => setConfigOpen(true)}
        quota={quota}
      />
      {configOpen && <ConfigPanel onClose={() => setConfigOpen(false)} />}

      {activeTab === 'live' && (
        <>
          {compacting && <CompactBanner />}
          <div style={liveLayout}>
            <TracePanel
              events={state.events} startedAt={state.startedAt}
              cost={state.cost} blockCosts={state.blockCosts}
              meta={metaStats} quota={quota}
              sessionState={state.sessionState}
              weeklyData={state.weeklyData}
              hiddenCost={hiddenCost}
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

      {activeTab === 'usage' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <UsageView quota={quota} cost={state.cost} events={state.events} prompts={prompts} />
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
      blockCosts:   (msg.blockCosts || []) as BlockCost[],
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
      model: p.model,
    }
    return { ...prev, cost }
  }
  if (msg.type === 'block_cost') {
    const p = msg.payload
    if (p.session_id !== prev.sessionId) return prev
    const entry: BlockCost = { inputUsd: p.inputUsd, outputUsd: p.outputUsd, totalUsd: p.totalUsd, inputTokens: p.inputTokens ?? 0, outputTokens: p.outputTokens ?? 0 }
    return { ...prev, blockCosts: [...prev.blockCosts, entry] }
  }
  // summary_ready — el daemon generó un resumen IA para la sesión activa
  // Refrescamos el historial en el próximo render (el usuario lo verá al abrir History)
  if (msg.type === 'summary_ready') return prev  // no-op aquí, historia se refresca al cambiar tab
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
      <Zap size={14} color="#d29922" />
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
