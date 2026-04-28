import { useState, useMemo } from 'react'
import { GitCompareArrows, X, History, List, GitGraph, Search, Sparkles } from 'lucide-react'
import type { DaySessions, SessionSummary } from '../types'
import { SessionCard } from './SessionCard'
import { Tip } from './Tip'

const MODE_COLOR_MAP: Record<string, string> = {
  directo: '#7d8590', agentes: '#d29922', skills: '#58a6ff', 'agentes+skills': '#d29922',
}

interface Props { days: DaySessions[]; activeSessionId?: string }

function fmtDate(dateStr: string) {
  const d         = new Date(dateStr + 'T12:00:00')
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

// ─── Comparison Panel ─────────────────────────────────────────────────────────

function diff(a: number, b: number, lowerIsBetter = false): React.CSSProperties {
  if (a === b) return { color: '#8b949e' }
  const better = lowerIsBetter ? a < b : a > b
  return { color: better ? '#3fb950' : '#f85149', fontWeight: 700 }
}

function ComparePanel({ a, b, onClose }: { a: SessionSummary; b: SessionSummary; onClose: () => void }) {
  const rows: { label: string; tooltip: string; va: string; vb: string; styleA: React.CSSProperties; styleB: React.CSSProperties }[] = [
    {
      label: 'Cost', tooltip: 'Total API cost of the session. Green = cheaper (better).',
      va: `$${a.total_cost_usd.toFixed(4)}`, vb: `$${b.total_cost_usd.toFixed(4)}`,
      styleA: diff(a.total_cost_usd, b.total_cost_usd, true),
      styleB: diff(b.total_cost_usd, a.total_cost_usd, true),
    },
    {
      label: 'Tokens', tooltip: 'Input + Output + Cache read. Green = fewer tokens consumed (better).',
      va: fmtTok(a.total_tokens), vb: fmtTok(b.total_tokens),
      styleA: diff(a.total_tokens, b.total_tokens, true),
      styleB: diff(b.total_tokens, a.total_tokens, true),
    },
    {
      label: 'Duration', tooltip: 'Time between first and last event. Green = shorter session (better).',
      va: fmtDuration(a.duration_ms), vb: fmtDuration(b.duration_ms),
      styleA: diff(a.duration_ms, b.duration_ms, true),
      styleB: diff(b.duration_ms, a.duration_ms, true),
    },
    {
      label: 'Efficiency', tooltip: 'Score 0–100 calculated by the daemon. Penalizes loops, re-reads and excessive context. Green = more efficient (better).',
      va: `${a.efficiency_score}/100`, vb: `${b.efficiency_score}/100`,
      styleA: diff(a.efficiency_score, b.efficiency_score, false),
      styleB: diff(b.efficiency_score, a.efficiency_score, false),
    },
    {
      label: 'Tools used', tooltip: 'Number of completed tool calls (Done type). Green = fewer calls for the same result (better).',
      va: `${a.done_count} calls`, vb: `${b.done_count} calls`,
      styleA: diff(a.done_count, b.done_count, true),
      styleB: diff(b.done_count, a.done_count, true),
    },
    {
      label: 'Loops', tooltip: 'Detected loops: same action repeated ≥3 times without real progress. Green = none or fewer (better).',
      va: `${a.loops_detected} loop${a.loops_detected !== 1 ? 's' : ''}`,
      vb: `${b.loops_detected} loop${b.loops_detected !== 1 ? 's' : ''}`,
      styleA: diff(a.loops_detected, b.loops_detected, true),
      styleB: diff(b.loops_detected, a.loops_detected, true),
    },
    {
      label: 'Mode', tooltip: 'Detected mode: direct (no agents or skills), agents, skills, or both.',
      va: a.mode, vb: b.mode,
      styleA: { color: MODE_COLOR_MAP[a.mode] ?? '#7d8590', fontWeight: 600 },
      styleB: { color: MODE_COLOR_MAP[b.mode] ?? '#7d8590', fontWeight: 600 },
    },
  ]

  const nameA = a.project_name || a.id.slice(0, 8)
  const nameB = b.project_name || b.id.slice(0, 8)

  return (
    <div style={{
      margin: '0 0 20px 0',
      background: '#161b22',
      border: '1px solid #30363d',
      borderLeft: '3px solid #58a6ff',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        borderBottom: '1px solid #21262d',
        background: '#1c2128',
      }}>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Session comparison</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
              Green = better · Red = worse<br />
              Metrics are compared against each other. For cost, tokens, duration and loops: less is better. For efficiency: more is better.
            </div>
          </div>
        }>
          <GitCompareArrows size={14} color="#58a6ff" style={{ cursor: 'default' }} />
        </Tip>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 13 }}>
          Session comparison
        </span>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Session A</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>{a.project_name ?? a.id.slice(0, 8)} · {new Date(a.started_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</div>
          </div>
        }>
          <span style={{ color: '#58a6ff', fontSize: 11, background: '#58a6ff18', borderRadius: 4, padding: '1px 7px', border: '1px solid #58a6ff30', cursor: 'default' }}>
            {new Date(a.started_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </Tip>
        <span style={{ color: '#6e7681', fontSize: 11 }}>vs</span>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#bc8cff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Session B</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>{b.project_name ?? b.id.slice(0, 8)} · {new Date(b.started_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</div>
          </div>
        }>
          <span style={{ color: '#bc8cff', fontSize: 11, background: '#bc8cff18', borderRadius: 4, padding: '1px 7px', border: '1px solid #bc8cff30', cursor: 'default' }}>
            {new Date(b.started_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </Tip>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Table */}
      <div style={{ padding: '0 0 8px 0' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '120px 1fr 1fr',
          padding: '6px 16px',
          borderBottom: '1px solid #21262d',
        }}>
          <span style={{ color: '#484f58', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Metric</span>
          <span style={{ color: '#58a6ff', fontSize: 10, fontWeight: 700 }}>{nameA}</span>
          <span style={{ color: '#bc8cff', fontSize: 10, fontWeight: 700 }}>{nameB}</span>
        </div>

        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 1fr',
            padding: '5px 16px',
            background: i % 2 === 0 ? 'transparent' : '#ffffff08',
          }}>
            <Tip position="top" align="left" content={
              <div>
                <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{row.label}</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>{row.tooltip}</div>
              </div>
            }>
              <span style={{ color: '#7d8590', fontSize: 11, cursor: 'default' }}>{row.label}</span>
            </Tip>
            <span style={{ fontSize: 12, ...row.styleA }}>{row.va}</span>
            <span style={{ fontSize: 12, ...row.styleB }}>{row.vb}</span>
          </div>
        ))}

        {/* Top tools diff */}
        {(a.top_tools.length > 0 || b.top_tools.length > 0) && (
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 1fr',
            padding: '5px 16px',
          }}>
            <Tip position="top" align="left" content={
              <div>
                <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Top tools</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Most invoked tools in each session, sorted by frequency</div>
              </div>
            }>
              <span style={{ color: '#7d8590', fontSize: 11, cursor: 'default' }}>Top tools</span>
            </Tip>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {(a.top_tools.length > 0 ? a.top_tools : ['—']).map((t, i) => (
                <span key={i} style={{ color: '#8b949e', fontSize: 10, background: '#ffffff08', borderRadius: 3, padding: '1px 5px' }}>{t}</span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {(b.top_tools.length > 0 ? b.top_tools : ['—']).map((t, i) => (
                <span key={i} style={{ color: '#8b949e', fontSize: 10, background: '#ffffff08', borderRadius: 3, padding: '1px 5px' }}>{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AI summaries */}
      {(a.ai_summary || b.ai_summary) && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 8, padding: '10px 16px',
          borderTop: '1px solid #21262d',
        }}>
          {[{ s: a, color: '#58a6ff' }, { s: b, color: '#bc8cff' }].map(({ s, color }) => (
            <div key={s.id} style={{
              background: color + '08', border: `1px solid ${color}20`,
              borderRadius: 6, padding: '7px 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <Sparkles size={10} color={color} />
                <span style={{ color, fontSize: 10, fontWeight: 700 }}>
                  {new Date(s.started_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span style={{ color: '#9198a1', fontSize: 11, fontStyle: 'italic', lineHeight: 1.4 }}>
                {s.ai_summary ?? <span style={{ color: '#484f58' }}>No summary</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const S = {
  wrap:    { padding: '16px 24px', overflowY: 'auto' as const, height: '100%' },
  dayWrap: { marginBottom: 28 },
  dayHead: {
    display: 'flex', alignItems: 'center', gap: 16,
    marginBottom: 10, paddingBottom: 6,
    borderBottom: '1px solid #21262d',
  },
  dayLabel: { color: '#e6edf3', fontWeight: 700, fontSize: 14 },
  dayStat:  { color: '#7d8590', fontSize: 11 },
  badge: (color: string): React.CSSProperties => ({
    color, background: color + '18', border: `1px solid ${color}30`,
    borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600,
  }),
  sessions: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  empty: {
    padding: '60px 24px', color: '#7d8590', textAlign: 'center' as const, fontSize: 13,
  },
}

function TimelineView({ days, activeSessionId }: { days: DaySessions[]; activeSessionId?: string }) {
  return (
    <div style={{ paddingLeft: 8 }}>
      <style>{`@keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.5)} }`}</style>
      {days.map(day => (
        <div key={day.date} style={{ marginBottom: 28 }}>
          {/* Day marker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#30363d', border: '2px solid #484f58', flexShrink: 0 }} />
            <div style={{ height: 1, width: 12, background: '#21262d' }} />
            <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 700 }}>{fmtDate(day.date)}</span>
            <span style={{ color: '#484f58', fontSize: 11 }}>
              {day.sessions.length} ses. · ${day.total_cost.toFixed(3)} · {fmtTok(day.total_tokens)}
            </span>
          </div>
          {/* Sessions on timeline */}
          <div style={{ position: 'relative', paddingLeft: 28 }}>
            <div style={{ position: 'absolute', left: 4, top: 0, bottom: 0, width: 2, background: '#21262d', borderRadius: 1 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {day.sessions.map(s => {
                const dotColor = s.efficiency_score >= 90 ? '#3fb950' : s.efficiency_score >= 70 ? '#d29922' : '#f85149'
                const isActive = s.id === activeSessionId
                return (
                  <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Tip position="top" align="left" content={
                      <div>
                        <div style={{ color: dotColor, fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Efficiency {s.efficiency_score}/100</div>
                        <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                          Green ≥90 · Amber ≥70 · Red &lt;70<br />
                          Penalizes loops, re-reads and excessive context
                        </div>
                      </div>
                    }>
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 6,
                        background: dotColor, border: '2px solid #0d1117',
                        boxShadow: `0 0 6px ${dotColor}66`, position: 'relative', zIndex: 1,
                        animation: isActive ? 'livePulse 1.5s ease-in-out infinite' : undefined,
                        cursor: 'default',
                      }} />
                    </Tip>
                    <div style={{
                      flex: 1, background: '#161b22', border: `1px solid ${isActive ? '#1f6feb' : '#21262d'}`,
                      borderRadius: 7, padding: '7px 12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Tip position="top" align="left" content={
                          <div>
                            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Start time</div>
                            <div style={{ color: '#7d8590', fontSize: 10 }}>First recorded event of the session</div>
                          </div>
                        }>
                          <span style={{ color: '#6e7681', fontSize: 10, fontFamily: 'monospace', cursor: 'default' }}>
                            {new Date(s.started_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </Tip>
                        {s.project_name && (
                          <span style={{ color: '#79c0ff', fontSize: 11, fontWeight: 600 }}>{s.project_name}</span>
                        )}
                        <Tip position="top" align="left" content={
                          <div>
                            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>API Cost</div>
                            <div style={{ color: '#7d8590', fontSize: 10 }}>Sum of all session blocks</div>
                          </div>
                        }>
                          <span style={{ color: '#3fb950', fontSize: 10, fontWeight: 600, cursor: 'default' }}>${s.total_cost_usd.toFixed(4)}</span>
                        </Tip>
                        <span style={{ color: '#484f58', fontSize: 10 }}>·</span>
                        <Tip position="top" align="left" content={
                          <div>
                            <div style={{ color: dotColor, fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Efficiency</div>
                            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Score 0–100. Penalizes loops, re-reads and excessive context</div>
                          </div>
                        }>
                          <span style={{ color: dotColor, fontSize: 10, cursor: 'default' }}>{s.efficiency_score}/100</span>
                        </Tip>
                        <Tip position="top" align="left" content={
                          <div>
                            <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total tokens</div>
                            <div style={{ color: '#7d8590', fontSize: 10 }}>Input + Output + Cache read</div>
                          </div>
                        }>
                          <span style={{ color: '#484f58', fontSize: 10, cursor: 'default' }}>· {fmtTok(s.total_tokens)} tok</span>
                        </Tip>
                        {s.ai_summary && (
                          <span style={{ color: '#7d8590', fontSize: 10, fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            — {s.ai_summary}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const COST_FILTERS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'All',     min: null,  max: null  },
  { label: '< $0.01', min: null,  max: 0.01  },
  { label: '$0.01+',  min: 0.01,  max: null  },
  { label: '$0.10+',  min: 0.10,  max: null  },
  { label: '$1+',     min: 1.00,  max: null  },
]

export function HistoryView({ days, activeSessionId }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMode, setViewMode]       = useState<'list' | 'timeline'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [costFilter, setCostFilter]   = useState(0) // índice en COST_FILTERS

  // Filtrado reactivo
  const filteredDays = useMemo(() => {
    const q   = searchQuery.trim().toLowerCase()
    const cf  = COST_FILTERS[costFilter]
    return days.map(day => ({
      ...day,
      sessions: day.sessions.filter(s => {
        if (cf.min !== null && s.total_cost_usd < cf.min) return false
        if (cf.max !== null && s.total_cost_usd >= cf.max) return false
        if (!q) return true
        return (
          s.project_name?.toLowerCase().includes(q) ||
          s.top_tools.some(t => t.toLowerCase().includes(q)) ||
          s.ai_summary?.toLowerCase().includes(q) ||
          s.id.includes(q)
        )
      }),
    })).filter(day => day.sessions.length > 0)
  }, [days, searchQuery, costFilter])

  // Buscar las sesiones seleccionadas en todos los días
  const allSessions = days.flatMap(d => d.sessions)
  const selA = allSessions.find(s => s.id === selectedIds[0])
  const selB = allSessions.find(s => s.id === selectedIds[1])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2)  return [prev[1], id]  // desplaza: mantiene el último + el nuevo
      return [...prev, id]
    })
  }

  if (days.length === 0) {
    return (
      <div style={{ ...S.empty, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <History size={40} color="#30363d" />
        <div>
          <div style={{ color: '#6e7681', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No sessions recorded</div>
          <div style={{ fontSize: 11, color: '#484f58' }}>Sessions appear here once the daemon processes them.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      {/* Barra de búsqueda */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 8, padding: '5px 10px',
        background: '#161b22', border: '1px solid #21262d', borderRadius: 6,
      }}>
        <Search size={12} color="#484f58" />
        <input
          type="text"
          placeholder="Search by project, tool or summary…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#c9d1d9', fontSize: 12, fontFamily: 'inherit',
          }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex' }}>
            <X size={12} />
          </button>
        )}
        <div style={{ width: 1, height: 16, background: '#21262d' }} />
        {/* Filtros de costo */}
        <div style={{ display: 'flex', gap: 3 }}>
          {COST_FILTERS.map((f, i) => {
            const tipText =
              i === 0 ? 'Show all sessions without filtering by cost' :
              i === 1 ? 'Only sessions with cost under $0.01 — very short conversations' :
              i === 2 ? 'Sessions with cost of $0.01 or more — real work' :
              i === 3 ? 'Sessions with cost of $0.10 or more — intensive work' :
                        'Sessions with cost of $1 or more — long or high-complexity sessions'
            return (
              <Tip key={i} position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Filtro: {f.label}</div>
                  <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>{tipText}</div>
                </div>
              }>
                <button
                  onClick={() => setCostFilter(i)}
                  style={{
                    padding: '2px 7px', borderRadius: 4, border: `1px solid ${costFilter === i ? '#3fb95060' : '#21262d'}`,
                    background: costFilter === i ? '#1a2d1a' : 'transparent',
                    color: costFilter === i ? '#3fb950' : '#6e7681',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >{f.label}</button>
              </Tip>
            )
          })}
        </div>
        {(searchQuery || costFilter > 0) && (
          <span style={{ color: '#484f58', fontSize: 10 }}>
            {filteredDays.reduce((acc, d) => acc + d.sessions.length, 0)} result{filteredDays.reduce((acc, d) => acc + d.sessions.length, 0) !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Toolbar: toggle vista + comparación */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 12, padding: '6px 10px',
        background: '#161b22', border: '1px solid #21262d', borderRadius: 6,
      }}>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: 2, background: '#0d1117', borderRadius: 5, padding: 2 }}>
          {([
            ['list',     List,     'List',     'Card view grouped by day. Shows all details for each session.'],
            ['timeline', GitGraph, 'Timeline', 'Chronological view with a timeline. Shows the session flow for the day.'],
          ] as const).map(([mode, Icon, label, tipText]) => (
            <Tip key={mode} position="bottom" align="left" content={
              <div>
                <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{label}</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>{tipText}</div>
              </div>
            }>
              <button
                onClick={() => setViewMode(mode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  background: viewMode === mode ? '#21262d' : 'transparent',
                  color: viewMode === mode ? '#e6edf3' : '#6e7681',
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={10} />{label}
              </button>
            </Tip>
          ))}
        </div>

        <div style={{ width: 1, height: 16, background: '#21262d' }} />

        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Compare sessions</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
              Click 2 sessions to compare their metrics.<br />
              If 2 are already selected, the new one replaces the oldest.
            </div>
          </div>
        }>
          <GitCompareArrows size={12} color="#58a6ff" style={{ cursor: 'default' }} />
        </Tip>
        <span style={{ color: '#6e7681', fontSize: 11 }}>
          {selectedIds.length === 0
            ? 'Select 2 sessions to compare'
            : selectedIds.length === 1
            ? 'Select 1 more'
            : 'Comparing 2 sessions'
          }
        </span>
        {selectedIds.length > 0 && (
          <button
            onClick={() => setSelectedIds([])}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex', marginLeft: 'auto' }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Panel de comparación */}
      {selA && selB && (
        <ComparePanel a={selA} b={selB} onClose={() => setSelectedIds([])} />
      )}

      {filteredDays.length === 0 && (searchQuery || costFilter > 0) && (
        <div style={{ ...S.empty }}>
          <Search size={32} color="#30363d" style={{ marginBottom: 8 }} />
          <div style={{ color: '#6e7681', fontSize: 13 }}>No results for "{searchQuery || COST_FILTERS[costFilter].label}"</div>
        </div>
      )}

      {viewMode === 'timeline'
        ? <TimelineView days={filteredDays} activeSessionId={activeSessionId} />
        : filteredDays.map(day => (
          <div key={day.date} style={S.dayWrap}>
            <div style={S.dayHead}>
              <span style={S.dayLabel}>{fmtDate(day.date)}</span>
              <Tip position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Day sessions</div>
                  <div style={{ color: '#7d8590', fontSize: 10 }}>Number of Claude Code sessions recorded this day</div>
                </div>
              }>
                <span style={{ ...S.dayStat, cursor: 'default' }}>{day.sessions.length} session{day.sessions.length > 1 ? 's' : ''}</span>
              </Tip>
              <span style={S.dayStat}>·</span>
              <Tip position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Accumulated duration</div>
                  <div style={{ color: '#7d8590', fontSize: 10 }}>Sum of the duration of all sessions in the day</div>
                </div>
              }>
                <span style={{ ...S.dayStat, cursor: 'default' }}>{fmtDuration(day.total_duration_ms)}</span>
              </Tip>
              <span style={S.dayStat}>·</span>
              <Tip position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Day cost</div>
                  <div style={{ color: '#7d8590', fontSize: 10 }}>Sum of API costs of all sessions in the day</div>
                </div>
              }>
                <span style={{ ...S.badge('#3fb950'), cursor: 'default' }}>${day.total_cost.toFixed(3)}</span>
              </Tip>
              <span style={S.dayStat}>·</span>
              <Tip position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Day tokens</div>
                  <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Sum of tokens (input + output + cache read) of all sessions in the day</div>
                </div>
              }>
                <span style={{ ...S.dayStat, cursor: 'default' }}>{fmtTok(day.total_tokens)} tokens</span>
              </Tip>
            </div>
            <div style={S.sessions}>
              {day.sessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  selectable
                  selected={selectedIds.includes(session.id)}
                  onSelect={toggleSelect}
                />
              ))}
            </div>
          </div>
        ))
      }
    </div>
  )
}
