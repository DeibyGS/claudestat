import type { ProjectSummary } from '../types'
import { ProjectCard } from './ProjectCard'

interface Props { projects: ProjectSummary[]; activeProject: string | null }

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const S = {
  wrap: { padding: '16px 24px', overflowY: 'auto' as const, height: '100%' },
  summary: {
    display: 'flex', alignItems: 'center', gap: 24,
    padding: '12px 16px', marginBottom: 20,
    background: '#161b22', borderRadius: 8, border: '1px solid #21262d',
  },
  sumItem: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  sumVal:  { color: '#e6edf3', fontWeight: 700, fontSize: 16 },
  sumLbl:  { color: '#7d8590', fontSize: 11 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 },
  empty:   { color: '#7d8590', fontSize: 13, padding: '40px 0', textAlign: 'center' as const },
  sep:     { width: 1, height: 32, background: '#21262d' },
}

export function ProjectsView({ projects, activeProject }: Props) {
  const totalCost     = projects.reduce((s, p) => s + p.total_cost_usd, 0)
  const totalTokens   = projects.reduce((s, p) => s + p.total_tokens, 0)
  const totalSessions = projects.reduce((s, p) => s + p.session_count, 0)
  const withHandoff   = projects.filter(p => p.has_handoff)
  const avgProgress   = withHandoff.length > 0
    ? Math.round(withHandoff.reduce((s, p) => s + p.progress.pct, 0) / withHandoff.length)
    : 0

  return (
    <div style={S.wrap}>
      {/* Resumen global */}
      <div style={S.summary}>
        <div style={S.sumItem}>
          <span style={S.sumVal}>{projects.length}</span>
          <span style={S.sumLbl}>proyectos</span>
        </div>
        <div style={S.sep} />
        <div style={S.sumItem}>
          <span style={S.sumVal}>${totalCost.toFixed(2)}</span>
          <span style={S.sumLbl}>coste total</span>
        </div>
        <div style={S.sep} />
        <div style={S.sumItem}>
          <span style={S.sumVal}>{fmtTok(totalTokens)}</span>
          <span style={S.sumLbl}>tokens totales</span>
        </div>
        <div style={S.sep} />
        <div style={S.sumItem}>
          <span style={S.sumVal}>{totalSessions}</span>
          <span style={S.sumLbl}>sesiones históricas</span>
        </div>
        {withHandoff.length > 0 && (
          <>
            <div style={S.sep} />
            <div style={S.sumItem}>
              <span style={{ ...S.sumVal, color: avgProgress >= 70 ? '#3fb950' : '#d29922' }}>
                {avgProgress}%
              </span>
              <span style={S.sumLbl}>progreso promedio</span>
            </div>
          </>
        )}
      </div>

      {/* Grid de proyectos */}
      {projects.length === 0 ? (
        <div style={S.empty}>
          No se encontraron proyectos todavía.<br />
          <span style={{ fontSize: 11 }}>
            Los proyectos aparecen cuando Claude Code accede a archivos de sus directorios.
          </span>
        </div>
      ) : (
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
