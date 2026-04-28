import { FolderGit2 } from 'lucide-react'
import type { ProjectSummary, DayStats } from '../types'
import { ProjectCard } from './ProjectCard'
import { Tip } from './Tip'

interface Props {
  projects:      ProjectSummary[]
  activeProject: string | null
  weeklyData?:   DayStats[]
  loading?:      boolean
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

/** C.13 — Mini heatmap de 7 días en la barra de resumen */
function WeeklyHeatmap({ data }: { data: DayStats[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.tokens), 1)
  const days = ['M','T','W','T','F','S','S']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {data.slice(-7).map((d, i) => {
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
                width: 12, height: 12, borderRadius: 2,
                background: bg,
                border: '1px solid #21262d',
              }} />
            </Tip>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {data.slice(-7).map((_, i) => (
          <span key={i} style={{ width: 12, fontSize: 8, color: '#484f58', textAlign: 'center' }}>
            {days[i]}
          </span>
        ))}
      </div>
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
  wrap:    { padding: '16px 24px', overflowY: 'auto' as const, height: '100%' },
  summary: {
    display: 'flex', alignItems: 'center', gap: 20,
    padding: '12px 16px', marginBottom: 20,
    background: '#161b22', borderRadius: 8, border: '1px solid #21262d',
    flexWrap: 'wrap' as const,
  },
  sumItem: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  sumVal:  { color: '#e6edf3', fontWeight: 700, fontSize: 16 },
  sumLbl:  { color: '#7d8590', fontSize: 11 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 },
  sep:     { width: 1, height: 32, background: '#21262d', flexShrink: 0 },
}

export function ProjectsView({ projects, activeProject, weeklyData = [], loading = false }: Props) {
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

      {/* Resumen global */}
      <div style={S.summary}>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Projects</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Number of projects detected by claudestat in <code>~/.claude/projects/</code></div>
          </div>
        }>
          <div style={S.sumItem}>
            <span style={S.sumVal}>{projects.length}</span>
            <span style={S.sumLbl}>projects</span>
          </div>
        </Tip>
        <div style={S.sep} />
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total cost</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Sum of all API costs of all sessions across all projects</div>
          </div>
        }>
          <div style={S.sumItem}>
            <span style={S.sumVal}>${totalCost.toFixed(2)}</span>
            <span style={S.sumLbl}>total cost</span>
          </div>
        </Tip>
        <div style={S.sep} />
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total tokens</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Input + Output + Cache read accumulated across all projects</div>
          </div>
        }>
          <div style={S.sumItem}>
            <span style={S.sumVal}>{fmtTok(totalTokens)}</span>
            <span style={S.sumLbl}>total tokens</span>
          </div>
        </Tip>
        <div style={S.sep} />
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Historical sessions</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Total sessions recorded by claudestat across all projects</div>
          </div>
        }>
          <div style={S.sumItem}>
            <span style={S.sumVal}>{totalSessions}</span>
            <span style={S.sumLbl}>historical sessions</span>
          </div>
        </Tip>
        {withHandoff.length > 0 && (
          <>
            <div style={S.sep} />
            <Tip position="bottom" align="left" content={
              <div>
                <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Average progress</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>% of completed tasks averaged across {withHandoff.length} project{withHandoff.length !== 1 ? 's' : ''} with HANDOFF.md</div>
              </div>
            }>
              <div style={S.sumItem}>
                <span style={{ ...S.sumVal, color: avgProgress >= 70 ? '#3fb950' : '#d29922' }}>
                  {avgProgress}%
                </span>
                <span style={S.sumLbl}>average progress</span>
              </div>
            </Tip>
          </>
        )}
        {/* C.13 — Heatmap 7 días */}
        {weeklyData.length > 0 && (
          <>
            <div style={S.sep} />
            <WeeklyHeatmap data={weeklyData} />
          </>
        )}
      </div>

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
          {projects.map(p => (
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
