import { useEffect, useRef, useState } from 'react'
import type { AppState, TraceEvent, CostInfo } from './types'
import { TracePanel }  from './components/TracePanel'
import { DAGView }     from './components/DAGView'
import { StatsFooter } from './components/StatsFooter'
import { Header }      from './components/Header'

const EMPTY: AppState = {
  sessionId: '', cwd: '', startedAt: Date.now(), events: [], weeklyData: []
}

export default function App() {
  const [state,      setState]     = useState<AppState>(EMPTY)
  const [connected,  setConnected] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let es: EventSource
    let retryTimer: ReturnType<typeof setTimeout>

    function connect() {
      es = new EventSource('/stream')

      es.addEventListener('open', () => setConnected(true))

      es.addEventListener('message', (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data)
          setState(prev => handleMessage(prev, msg))
        } catch { /* ignore malformed */ }
      })

      es.addEventListener('error', () => {
        setConnected(false)
        es.close()
        retryTimer = setTimeout(connect, 2000)
      })
    }

    connect()
    return () => { es?.close(); clearTimeout(retryTimer) }
  }, [])

  const style: React.CSSProperties = {
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    height: '100vh',
    overflow: 'hidden',
  }

  return (
    <div style={style}>
      <Header state={state} connected={connected} />

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', overflow: 'hidden' }}>
        <TracePanel events={state.events} startedAt={state.startedAt} cost={state.cost} />
        <DAGView    events={state.events} startedAt={state.startedAt} />
      </div>

      <StatsFooter cost={state.cost} weeklyData={state.weeklyData} />
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
      sessionId: s.id,
      cwd:       s.cwd || '',
      startedAt: s.started_at,
      events:    (msg.events || []) as TraceEvent[],
      cost:      buildCost(s),
    }
  }

  if (msg.type === 'event') {
    const evt = msg.payload as TraceEvent & { session_id: string }

    // Nueva sesión
    if (evt.session_id && evt.session_id !== prev.sessionId && prev.sessionId !== '') {
      return { ...EMPTY, sessionId: evt.session_id, cwd: evt.cwd || '', startedAt: evt.ts, events: [] }
    }

    let events = [...prev.events]

    if (evt.type === 'Done' && evt.tool_name) {
      // Actualizar PreToolUse → Done
      const idx = [...events].reverse().findIndex(
        e => e.type === 'PreToolUse' && e.tool_name === evt.tool_name
      )
      if (idx !== -1) {
        const realIdx = events.length - 1 - idx
        events[realIdx] = { ...events[realIdx], type: 'Done', duration_ms: evt.ts - events[realIdx].ts }
      }
    } else {
      events = [...events, evt]
    }

    const nextState = { ...prev, events }
    if (!prev.sessionId && evt.session_id) {
      nextState.sessionId = evt.session_id
      nextState.cwd       = evt.cwd || ''
      nextState.startedAt = evt.ts
    }
    return nextState
  }

  if (msg.type === 'cost_update') {
    const p = msg.payload
    if (p.session_id !== prev.sessionId) return prev
    const cost: CostInfo = {
      cost_usd:         p.cost_usd,
      input_tokens:     p.input_tokens,
      output_tokens:    p.output_tokens,
      cache_read:       p.cache_read,
      cache_creation:   p.cache_creation,
      efficiency_score: p.efficiency_score,
      context_used:     p.context_used,
      context_window:   p.context_window,
      loops:            p.loops || [],
      summary:          p.summary,
    }
    return { ...prev, cost }
  }

  return prev
}

function buildCost(session: any): CostInfo | undefined {
  if (!session?.total_cost_usd) return undefined
  return {
    cost_usd:         session.total_cost_usd       ?? 0,
    input_tokens:     session.total_input_tokens   ?? 0,
    output_tokens:    session.total_output_tokens  ?? 0,
    cache_read:       session.total_cache_read     ?? 0,
    cache_creation:   session.total_cache_creation ?? 0,
    efficiency_score: session.efficiency_score     ?? 100,
    loops: [],
  }
}
