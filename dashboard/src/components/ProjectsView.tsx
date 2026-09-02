import { useState } from 'react'
import { FolderGit2, Search, DollarSign, Cpu, Clock, BarChart3 } from 'lucide-react'
import type { ProjectSummary, DayStats } from '../types'
import { ProjectCard } from './ProjectCard'
import { Tip } from './Tip'
import { fmtTok } from './shared'

interface Props {
  projects:      ProjectSummary[]
  activeProject: string | null
  weeklyData?:   DayStats[]
  loading?:      boolean
}

const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/** C.13 — Mini heatmap de 7 días en la barra de resumen */
function WeeklyHeatmap({ data }: { data: DayStats[] }) {
  if (data.length === 0) return null
  const max  = Math.max(...data.map(d => d.tokens), 1)
  const week = data.slice(-7)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {week.map((d, i) => {
        const pct = d.tokens / max
        const bg  = pct < 0.05 ? '#1c2128'
          : pct < 0.3  ? '#0e4429'
          : pct < 0.6  ? '#006d32'
          : pct < 0.85 ? '#26a641'
          : '#39d353'
        return (
          <Tip key={i} position="top" align="right" content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 3 }}>{d.date}</div>
              <div style={{ color: '#7d8590', fontSize: 10 }}>{fmtTok(d.tokens)} tokens that day</div>
            </div>
          }>
            <div style={{
              width: 10, height: 10, borderRadius: 2,
              background: bg,
              border: '1px solid #21262d',
            }} />
          </Tip>
        )
      })}
    </div>
  )
}

/** B.7 — Skeleton card de carga */
function SkeletonCard() {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d',
      borderRadius: 10, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 120, height: 14, borderRadius: 4, background: '#21262d', animation: 'skeletonShimmer 1.4s ease-in-out infinite' }} />
        <div style={{ width: 40,  height: 14, borderRadius: 4, background: '#21262d', animation: 'skeletonShimmer 1.4s ease-in-out infinite 0.2s' }} />
      </div>
      <div style={{ width: '70%', height: 10, borderRadius: 3, background: '#21262d', animation: 'skeletonShimmer 1.4s ease-in-out infinite 0.1s' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 12, borderRadius: 3, background: '#21262d', animation: `skeletonShimmer 1.4s ease-in-out infinite ${i * 0.1}s` }} />
            <div style={{ height: 8,  borderRadius: 2, background: '#21262d', animation: `skeletonShimmer 1.4s ease-in-out infinite ${i * 0.1 + 0.1}s` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

const S = {
  wrap:    { padding: '12px 20px', overflowY: 'auto' as const, overflowX: 'hidden' as const, height: '100%' },
  kpiRow:  { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 },
  kpiCard: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#161b22', borderRadius: 8, border: '1px solid #21262d', minWidth: 0 },
  kpiIcon: (bg: string): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: 6, background: bg,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }),
  kpiVal:  { color: '#e6edf3', fontWeight: 700, fontSize: 15, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  kpiLbl:  { color: '#7d8590', fontSize: 9, lineHeight: 1.2 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
}

const FILTERS: { key: string; label: string; fn: (p: ProjectSummary) => boolean }[] = [
  { key: 'active7d',  label: 'Active 7d',      fn: p => (p.last_active ?? 0) > Date.now() - 7 * 86_400_000 },
  { key: 'cost10',    label: 'Cost > $10',      fn: p => p.total_cost_usd > 10 },
  { key: 'eff70',     label: 'Efficiency < 70', fn: p => p.avg_efficiency !== null && (p.avg_efficiency ?? 100) < 70 },
]

export function ProjectsView({ projects, activeProject, weeklyData = [], loading = false }: Props) {
  const [query,   setQuery]   = useState('')
  const [filters, setFilters] = useState<Set<string>>(new Set())

  const toggleFilter = (key: string) =>
    setFilters(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  const filtered = projects.filter(p => {
    if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false
    for (const key of filters) {
      const f = FILTERS.find(f => f.key === key)
      if (f && !f.fn(p)) return false
    }
    return true
  })

  const totalCost     = projects.reduce((s, p) => s + p.total_cost_usd, 0)
  const totalTokens   = projects.reduce((s, p) => s + p.total_tokens, 0)
  const totalSessions = projects.reduce((s, p) => s + p.session_count, 0)
  const withHandoff   = projects.filter(p => p.has_handoff && !p.auto_handoff)
  const avgProgress   = withHandoff.length > 0
    ? Math.round(withHandoff.reduce((s, p) => s + p.progress.pct, 0) / withHandoff.length)
    : 0

  return (
    <div style={S.wrap}>
      <style>{`
        @keyframes skeletonShimmer {
          0%,100% { opacity: 1 }
          50%      { opacity: 0.4 }
        }
      `}</style>

      {/* KPI cards */}
      <div style={S.kpiRow}>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Projects</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>Detected in <code>~/.claude/projects/</code></div>
          </div>
        }>
          <div style={S.kpiCard}>
            <div style={S.kpiIcon('#58a6ff18')}>
              <FolderGit2 size={16} color="#58a6ff" />
            </div>
            <div>
              <div style={S.kpiVal}>{projects.length}</div>
              <div style={S.kpiLbl}>projects</div>
            </div>
          </div>
        </Tip>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total cost</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>Sum of all API costs across all projects</div>
          </div>
        }>
          <div style={S.kpiCard}>
            <div style={S.kpiIcon('#3fb95018')}>
              <DollarSign size={16} color="#3fb950" />
            </div>
            <div>
              <div style={{ ...S.kpiVal, color: '#3fb950' }}>${totalCost.toFixed(2)}</div>
              <div style={S.kpiLbl}>total cost</div>
            </div>
          </div>
        </Tip>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total tokens</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>Input + Output + Cache read</div>
          </div>
        }>
          <div style={S.kpiCard}>
            <div style={S.kpiIcon('#79c0ff18')}>
              <Cpu size={16} color="#79c0ff" />
            </div>
            <div>
              <div style={{ ...S.kpiVal, color: '#79c0ff' }}>{fmtTok(totalTokens)}</div>
              <div style={S.kpiLbl}>tokens</div>
            </div>
          </div>
        </Tip>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Sessions</div>
            <div style={{ color: '#7d8590', fontSize: 10 }}>Total recorded across all projects</div>
          </div>
        }>
          <div style={S.kpiCard}>
            <div style={S.kpiIcon('#e6edf318')}>
              <Clock size={16} color="#e6edf3" />
            </div>
            <div>
              <div style={S.kpiVal}>{totalSessions}</div>
              <div style={S.kpiLbl}>sessions</div>
            </div>
          </div>
        </Tip>
        {withHandoff.length > 0 && (
          <Tip position="bottom" align="left" content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Avg progress</div>
              <div style={{ color: '#7d8590', fontSize: 10 }}>Across {withHandoff.length} project{withHandoff.length !== 1 ? 's' : ''} with HANDOFF</div>
            </div>
          }>
            <div style={S.kpiCard}>
              <div style={S.kpiIcon(avgProgress >= 70 ? '#3fb95018' : '#d2992218')}>
                <BarChart3 size={16} color={avgProgress >= 70 ? '#3fb950' : '#d29922'} />
              </div>
              <div>
                <div style={{ ...S.kpiVal, color: avgProgress >= 70 ? '#3fb950' : '#d29922' }}>
                  {avgProgress > 0 ? `${avgProgress}%` : '—'}
                </div>
                <div style={S.kpiLbl}>avg progress</div>
              </div>
            </div>
          </Tip>
        )}
      </div>

      {/* M4 — Búsqueda + filtros */}
      {!loading && projects.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 140 }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#484f58', pointerEvents: 'none' }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search projects…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
                color: '#e6edf3', fontSize: 12, padding: '6px 10px 6px 28px',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
          {FILTERS.map(f => {
            const active = filters.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => toggleFilter(f.key)}
                style={{
                  border: `1px solid ${active ? '#58a6ff' : '#30363d'}`,
                  borderRadius: 20, padding: '4px 12px', fontSize: 11,
                  color: active ? '#58a6ff' : '#7d8590',
                  background: active ? '#1f6feb22' : 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {f.label}
              </button>
            )
          })}
          {(query || filters.size > 0) && (
            <span style={{ fontSize: 11, color: '#484f58' }}>{filtered.length} / {projects.length}</span>
          )}
        </div>
      )}

      {/* B.7 — Skeleton mientras carga */}
      {loading && (
        <div style={S.grid}>
          {[0,1,2].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* B.6 — Empty state con icono */}
      {!loading && projects.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 0', gap: 16, color: '#484f58',
        }}>
          <FolderGit2 size={48} strokeWidth={1.2} color="#30363d" />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6e7681', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
              No projects detected
            </div>
            <div style={{ color: '#484f58', fontSize: 12, lineHeight: 1.6 }}>
              Projects appear automatically when<br />
              Claude Code accesses files in their directories.
            </div>
          </div>
        </div>
      )}

      {/* Grid de proyectos */}
      {!loading && projects.length > 0 && (
        <div style={S.grid}>
          {filtered.map(p => (
            <ProjectCard
              key={p.path}
              project={p}
              isActive={p.path === activeProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}
