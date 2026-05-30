import { useState, memo } from 'react'
import { ChevronDown, ChevronUp, Lightbulb, TriangleAlert, CheckCircle2, FolderOpen } from 'lucide-react'
import type { ProjectSummary, ModelUsage, PatternInsight, InsightLevel } from '../types'
import { Tip } from './Tip'
import { fmtTok, fmtHours, fmtCost } from './shared'

interface Props { project: ProjectSummary; isActive?: boolean }
/** Returns the label of the model that consumed the most tokens, or null if tied/empty */
function dominantModel(usage: ModelUsage | undefined): { label: string; color: string } | null {
  if (!usage) return null
  const { opusTokens, sonnetTokens, haikuTokens } = usage
  if (opusTokens === 0 && sonnetTokens === 0 && haikuTokens === 0) return null
  if (opusTokens >= sonnetTokens && opusTokens >= haikuTokens) return { label: 'Opus',   color: '#d29922' }
  if (sonnetTokens >= haikuTokens)                               return { label: 'Sonnet', color: '#58a6ff' }
  return                                                                { label: 'Haiku',  color: '#3fb950' }
}

function relativeTime(ts: number | null) {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000)          return 'just now'
  if (diff < 3_600_000)       return `${Math.round(diff/60_000)}m ago`
  if (diff < 86_400_000)      return `${Math.round(diff/3_600_000)}h ago`
  if (diff < 7 * 86_400_000)  return `${Math.round(diff/86_400_000)}d ago`
  return new Date(ts).toLocaleDateString('en', { day:'numeric', month:'short' })
}

/** Barra horizontal de tiempo por herramienta (Claude Code / OpenCode) */
function ToolTimeBars({ cliHours }: { cliHours: Record<string, number> }) {
  const entries = Object.entries(cliHours).filter(([, h]) => h > 0)
  if (entries.length === 0) return null

  const total = entries.reduce((s, [, h]) => s + h, 0)

  const TOOL_COLORS: Record<string, string> = {
    'claude-code': '#58a6ff',
    'opencode':    '#3fb950',
  }
  const TOOL_LABELS: Record<string, string> = {
    'claude-code': 'Claude Code',
    'opencode':    'OpenCode',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Tip position="top" align="left" content={
        <div>
          <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Usage by tool</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entries.map(([src, h]) => (
              <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: TOOL_COLORS[src] ?? '#7d8590', flexShrink: 0 }} />
                <span style={{ color: TOOL_COLORS[src] ?? '#7d8590', fontSize: 10, fontWeight: 700, width: 66 }}>{TOOL_LABELS[src] ?? src}</span>
                <span style={{ color: '#c9d1d9', fontSize: 10 }}>{fmtHours(h)}</span>
                <span style={{ color: '#484f58', fontSize: 9 }}>{Math.round(h / total * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      }>
        <span style={{ color: '#7d8590', fontSize: 10, marginBottom: 1 }}>tool usage</span>
      </Tip>
      {/* Barra segmentada */}
      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        {entries.map(([src, h]) => {
          const pct = h / total * 100
          return (
            <div key={src} style={{
              height: '100%',
              width: `${Math.round(pct)}%`,
              background: TOOL_COLORS[src] ?? '#7d8590',
              minWidth: h > 0 ? 2 : 0,
            }} />
          )
        })}
      </div>
      {/* Leyenda */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {entries.map(([src, h]) => (
          <span key={src} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: TOOL_COLORS[src] ?? '#7d8590', flexShrink: 0 }} />
            <span style={{ color: TOOL_COLORS[src] ?? '#7d8590', fontSize: 9, fontWeight: 700 }}>{TOOL_LABELS[src] ?? src}</span>
            <span style={{ color: '#7d8590', fontSize: 9 }}>{fmtHours(h)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Insight colors ───────────────────────────────────────────────────────────

const INSIGHT_COLOR: Record<InsightLevel, string> = {
  tip:      '#58a6ff',
  warning:  '#d29922',
  positive: '#3fb950',
}
const INSIGHT_ICON: Record<InsightLevel, typeof Lightbulb> = {
  tip:      Lightbulb,
  warning:  TriangleAlert,
  positive: CheckCircle2,
}

function InsightsPanel({ insights }: { insights: PatternInsight[] }) {
  const [open, setOpen] = useState(false)
  if (insights.length === 0) return null

  const warnCount = insights.filter(i => i.level === 'warning').length
  const headerColor = warnCount > 0 ? '#d29922' : '#58a6ff'

  return (
    <div style={{ borderTop: '1px solid #21262d', paddingTop: 8 }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 0',
        }}
      >
        <span style={{ color: headerColor, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
          {warnCount > 0
            ? <TriangleAlert size={12} />
            : <Lightbulb size={12} />
          }
          {insights.length} insight{insights.length > 1 ? 's' : ''}
          {warnCount > 0 && (
            <span style={{ color: '#d29922', fontSize: 10 }}>· {warnCount} warning{warnCount > 1 ? 's' : ''}</span>
          )}
        </span>
        {open ? <ChevronUp size={14} color="#484f58" /> : <ChevronDown size={14} color="#484f58" />}
      </button>

      {/* Insight list */}
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {insights.map((ins, i) => {
            const color = INSIGHT_COLOR[ins.level]
            return (
              <div key={i} style={{
                background: color + '0d',
                border: `1px solid ${color}30`,
                borderRadius: 6,
                padding: '7px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  {(() => { const Icon = INSIGHT_ICON[ins.level]; return <Icon size={11} color={color} /> })()}
                  <span style={{ color, fontSize: 11, fontWeight: 700 }}>{ins.title}</span>
                  {ins.metric && (
                    <span style={{ color: '#7d8590', fontSize: 9, marginLeft: 'auto' }}>{ins.metric}</span>
                  )}
                </div>
                <p style={{ color: '#8b949e', fontSize: 10, margin: 0, lineHeight: 1.5 }}>
                  {ins.description}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const S = {
  card: (active: boolean): React.CSSProperties => ({
    background: active ? '#1c2128' : '#161b22',
    border: `1px solid ${active ? '#1f6feb' : '#21262d'}`,
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'default',
    transition: 'border-color 0.2s',
    overflow: 'hidden',
    minWidth: 0,
  }),
  header: { display: 'flex', alignItems: 'center', gap: 8 },
  name:   { color: '#e6edf3', fontWeight: 700, fontSize: 15, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activeBadge: {
    color: '#3fb950', background: '#3fb95018', border: '1px solid #3fb95030',
    borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700,
  } as React.CSSProperties,
  autoBadge: {
    color: '#7d8590', background: '#7d859015', border: '1px solid #7d859030',
    borderRadius: 4, padding: '1px 6px', fontSize: 9,
  } as React.CSSProperties,
  path: { color: '#7d8590', fontSize: 10, marginTop: -4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },

  progressWrap: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  progressRow:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel:{ color: '#7d8590', fontSize: 11 },
  progressPct:  (pct: number): React.CSSProperties => ({
    color: pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : '#7d8590',
    fontWeight: 700, fontSize: 12,
  }),
  barTrack: { height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' as const },
  barFill:  (pct: number): React.CSSProperties => ({
    height: '100%',
    width: `${pct}%`,
    background: pct >= 80 ? '#3fb950' : pct >= 50 ? '#d29922' : '#58a6ff',
    borderRadius: 3,
    transition: 'width 0.5s ease',
    boxShadow: `0 0 4px ${pct >= 80 ? '#3fb95088' : pct >= 50 ? '#d2992288' : '#58a6ff88'}`,
  }),
  nextTask: { color: '#58a6ff', fontSize: 10, fontStyle: 'italic' as const, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },

  stats: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10, marginTop: 2,
  },
  stat: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  statVal: { color: '#e6edf3', fontWeight: 700, fontSize: 12 },
  statLbl: { color: '#7d8590', fontSize: 10 },
}

function ProjectCardInner({ project: p, isActive }: Props) {
  const isAutoHandoff = !!p.auto_handoff
  const topModel = dominantModel(p.model_usage)

  return (
    <div style={S.card(!!isActive)}>
      {/* Nombre + path */}
      <div>
        <div style={S.header}>
          <span style={{ ...S.name, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FolderOpen size={14} color="#6e7681" style={{ flexShrink: 0 }} />
            {p.name}
          </span>
          {isActive && (
            <Tip position="top" align="right" content={
              <div>
                <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Active project</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Claude Code is currently working in this directory</div>
              </div>
            }>
              <span style={S.activeBadge}>● active</span>
            </Tip>
          )}
          {isAutoHandoff && (
            <Tip position="top" align="right" content={
              <div>
                <div style={{ color: '#7d8590', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Auto-generated HANDOFF</div>
                <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>The daemon generated an automatic HANDOFF.md. Edit it to record your pending tasks.</div>
              </div>
            }>
              <span style={S.autoBadge}>HANDOFF auto</span>
            </Tip>
          )}
        </div>
        <Tip position="bottom" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Project path</div>
            <div style={{ color: '#79c0ff', fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>{p.path}</div>
          </div>
        }>
          <div style={S.path}>{p.path.split('/').slice(-3).join('/')}</div>
        </Tip>
      </div>

      {/* Progress (tareas del HANDOFF) */}
      {p.has_handoff ? (
        <div style={S.progressWrap}>
          {p.progress.total === 0 ? (
            <span style={{ ...S.progressLabel, fontStyle: 'italic' }}>
              {isAutoHandoff
                ? '→ Auto-generated HANDOFF — fill in the sections with your tasks'
                : 'no tasks recorded'}
            </span>
          ) : p.progress.done === 0 ? (
            <>
              <span style={S.progressLabel}>
                {p.progress.total} pending task{p.progress.total > 1 ? 's' : ''}
              </span>
              {p.progress.nextTask && (
                <div style={S.nextTask}>→ next: {p.progress.nextTask}</div>
              )}
            </>
          ) : (
            <>
              <div style={S.progressRow}>
                <span style={S.progressLabel}>
                  {p.progress.done}/{p.progress.total} tasks
                </span>
                <Tip position="top" align="right" content={
                  <div>
                    <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>HANDOFF progress</div>
                    <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>
                      {p.progress.done} completed task{p.progress.done !== 1 ? 's' : ''} out of {p.progress.total} in HANDOFF.md
                    </div>
                  </div>
                }>
                  <span style={S.progressPct(p.progress.pct)}>{p.progress.pct}%</span>
                </Tip>
              </div>
              <div style={S.barTrack}>
                <div style={S.barFill(p.progress.pct)} />
              </div>
              {p.progress.nextTask && (
                <div style={S.nextTask}>→ next: {p.progress.nextTask}</div>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Tiempo por herramienta */}
      {p.cli_hours && Object.keys(p.cli_hours).length > 0 && (
        <ToolTimeBars cliHours={p.cli_hours} />
      )}

      {/* Stats: coste · tokens · sesiones · última actividad */}
      <div style={S.stats}>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total cost</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Sum of all API costs of the sessions in this project</div>
          </div>
        }>
          <div style={S.stat}>
            <span style={S.statVal}>{fmtCost(p.total_cost_usd)}</span>
            <span style={S.statLbl}>
              total cost
              {p.session_count > 1 && (
                <span style={{ color: '#484f58', marginLeft: 3 }}>· {fmtCost(p.total_cost_usd / p.session_count)}/ses</span>
              )}
            </span>
          </div>
        </Tip>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total tokens</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
              Input + Output + Cache read accumulated.<br />
              {topModel ? <>Dominant model: <span style={{ color: topModel.color, fontWeight: 700 }}>{topModel.label}</span></> : 'No model data'}
            </div>
          </div>
        }>
          <div style={S.stat}>
            <span style={S.statVal}>{fmtTok(p.total_tokens)}</span>
            <span style={S.statLbl}>
              tokens
              {topModel && (
                <span style={{ color: topModel.color, marginLeft: 3 }}>· {topModel.label}</span>
              )}
            </span>
          </div>
        </Tip>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Sessions</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Total recorded sessions, including those before claudestat was installed (recorded from tool activity).</div>
          </div>
        }>
          <div style={S.stat}>
            <span style={S.statVal}>{p.session_count}</span>
            <span style={S.statLbl}>sessions</span>
          </div>
        </Tip>
        <Tip position="top" align="right" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Last activity</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>
              {p.last_active
                ? new Date(p.last_active).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
                : 'No activity recorded'}
            </div>
          </div>
        }>
          <div style={S.stat}>
            <span style={S.statVal}>{relativeTime(p.last_active)}</span>
            <span style={S.statLbl}>last seen</span>
          </div>
        </Tip>
      </div>

      {/* Insights — collapsible, only shown when patterns are detected */}
      {p.insights && p.insights.length > 0 && (
        <InsightsPanel insights={p.insights} />
      )}
    </div>
  )
}

export const ProjectCard = memo(ProjectCardInner)
