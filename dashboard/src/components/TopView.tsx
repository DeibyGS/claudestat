import { useEffect, useState, useCallback } from 'react'
import { Wrench, DollarSign, Clock, Hash, HelpCircle, ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import { Tip } from './Tip'
import { sourceColor, sourceLabel } from './shared'

interface TopTool {
  tool:             string
  source:           string
  count:            number
  totalDurationMs:  number
  estimatedCostUsd: number
  pctCost:          number
  pctCount:         number
}

interface TopData {
  by:     string
  days:   number
  source: string
  tools:  TopTool[]
}

interface CostProjection {
  weekly:  { daysWithData: number; costSoFar: number; projected: number }
  monthly: { daysWithData: number; costSoFar: number; projected: number }
}

type SortBy = 'cost' | 'count' | 'duration'
type SourceFilter = 'all' | 'claude-code' | 'opencode'

interface FilterButtonProps<T extends string | number> {
  value: T
  options: Array<{ key: T; label: string; icon?: LucideIcon; color?: string; tip?: string }>
  onChange: (value: T) => void
}

function FilterButton<T extends string | number>({ value, options, onChange }: FilterButtonProps<T>) {
  return (
    <div style={{ display: 'flex', gap: options.some(o => o.tip) ? 6 : 4 }}>
      {options.map(({ key, label, icon: Icon, color, tip }) => {
        const isActive = value === key
        const activeColor = color ?? '#e6edf3'
        return (
          <Tip key={String(key)} position="bottom" align="left" content={
            tip ? (
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: activeColor, marginBottom: 4 }}>{label}</div>
                <div style={{ color: '#7d8590' }}>{tip}</div>
              </div>
            ) : undefined
          }>
            <button
              onClick={() => onChange(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: Icon ? 5 : 0,
                padding: '4px 8px', fontSize: 11, fontWeight: isActive ? 600 : 400,
                color: isActive ? activeColor : '#8b949e',
                background: isActive ? (color ? color + '18' : '#21262d') : 'transparent',
                border: `1px solid ${isActive ? (color ? color + '50' : '#30363d') : 'transparent'}`,
                borderRadius: 5, cursor: 'pointer',
              }}
            >
              {Icon && <Icon size={11} color={isActive ? activeColor : undefined} />} {label}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}

function fmtCostPrecise(n: number): string {
  if (n < 0.00001) return '$0'
  if (n < 0.001) return `$${n.toFixed(6)}`
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

const COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f0883e', '#bc8cff',
  '#f778ba', '#79c0ff', '#56d364', '#e3b341', '#ff7b72',
]
const GRID_COLS = '32px 200px 70px 60px 80px 80px'

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 60, h = 16, pad = 2
  if (!data.length) return <svg width={w} height={h}><line x1={0} y1={h/2} x2={w} y2={h/2} stroke={color} strokeWidth={1} opacity={0.3} /></svg>
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = data.length === 1 ? w/2 : (i / (data.length - 1)) * (w - pad*2) + pad
    const y = h - pad - ((v / max) * (h - pad*2))
    return `${x},${y}`
  }).join(' ')
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>
}

export function TopView() {
  const [data, setData] = useState<TopData | undefined>()
  const [projection, setProjection] = useState<CostProjection | undefined>()
  const [sortBy, setSortBy] = useState<SortBy>('cost')
  const [days, setDays] = useState(30)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [loading, setLoading] = useState(false)
  const [otherTools, setOtherTools] = useState<TopTool[]>([])
  const [otherExpanded, setOtherExpanded] = useState(false)
  const [otherLoading, setOtherLoading] = useState(false)
  const [sparklines, setSparklines] = useState<Record<string,{day:string;calls:number;cost:number}[]>>({})

  const fetchOther = useCallback(() => {
    if (otherExpanded) { setOtherExpanded(false); return }
    setOtherLoading(true)
    fetch(`/api/top-other?by=${sortBy}&days=${days}&source=${sourceFilter}`)
      .then(r => r.ok ? r.json() : undefined)
      .then(d => { if (d) setOtherTools(d.tools ?? []); setOtherExpanded(true) })
      .catch(() => {})
      .finally(() => setOtherLoading(false))
  }, [otherExpanded, sortBy, days, sourceFilter])

  useEffect(() => { setOtherExpanded(false) }, [sortBy, days, sourceFilter])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/top?by=${sortBy}&limit=10&days=${days}&source=${sourceFilter}`)
      .then(r => r.ok ? r.json() : undefined)
      .then(d => { if (d) setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [sortBy, days, sourceFilter])

  useEffect(() => {
    if (!data?.tools?.length) return
    const toolNames = data.tools.filter(t => t.tool !== 'Other').map(t => t.tool)
    if (!toolNames.length) return
    fetch(`/api/top-sparklines?days=7&tools=${toolNames.join(',')}`)
      .then(r => r.ok ? r.json() : undefined)
      .then(d => d && setSparklines(d.sparklines ?? {}))
      .catch(() => {})
  }, [data])

  useEffect(() => {
    fetch('/cost-projection')
      .then(r => r.ok ? r.json() : undefined)
      .then(d => d && setProjection(d))
      .catch(() => {})
  }, [])

  const tools = data?.tools ?? []
  const maxCost = Math.max(...tools.map(t => t.estimatedCostUsd), 0.001)
  const maxCount = Math.max(...tools.map(t => t.count), 1)
  const maxDuration = Math.max(...tools.map(t => t.totalDurationMs), 1)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 24px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>
          Tool Rankings
        </h2>

        <FilterButton<SortBy>
          value={sortBy}
          options={[
            { key: 'cost',     label: 'Cost',     icon: DollarSign, color: '#3fb950', tip: "Estimated USD cost per tool, calculated from each tool's share of total token usage" },
            { key: 'count',    label: 'Calls',    icon: Hash,        color: '#58a6ff', tip: 'Total number of invocations in the selected period' },
            { key: 'duration', label: 'Duration', icon: Clock,       color: '#e3b341', tip: 'Cumulative execution time (sum of all calls)' },
          ]}
          onChange={setSortBy}
        />

        <FilterButton<SourceFilter>
          value={sourceFilter}
          options={[
            { key: 'all',         label: 'All',         tip: 'Show tools from all AI assistants combined' },
            { key: 'claude-code', label: 'Claude Code', color: '#58a6ff', tip: 'Show only tools used by Claude Code' },
            { key: 'opencode',    label: 'OpenCode',    color: '#3fb950', tip: 'Show only tools used by OpenCode' },
          ]}
          onChange={setSourceFilter}
        />

        <FilterButton<number>
          value={days}
          options={[7, 30, 90].map(d => ({ key: d, label: `${d}d` }))}
          onChange={setDays}
        />
      </div>

      {/* Cost projection cards */}
      {projection && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <ProjectionCard
            label="This week"
            tooltip="Cost accumulated since Monday of the current week, extrapolated to 7 days"
            costSoFar={projection.weekly.costSoFar}
            projected={projection.weekly.projected}
            daysWithData={projection.weekly.daysWithData}
          />
          <ProjectionCard
            label="This month"
            tooltip="Cost accumulated since the 1st of the current month, extrapolated to 30 days"
            costSoFar={projection.monthly.costSoFar}
            projected={projection.monthly.projected}
            daysWithData={projection.monthly.daysWithData}
          />
        </div>
      )}

      {/* Tool table */}
      {tools.length === 0 ? (
        <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
          {loading ? 'Loading…' : 'No tool usage data for this period.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading && <div style={{ fontSize: 10, color: '#484f58', marginBottom: 6 }}>Refreshing…</div>}
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: GRID_COLS,
            gap: 8, padding: '0 8px', fontSize: 10, fontWeight: 600, color: '#8b949e',
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            <span>#</span>
            <span>Tool</span>
            <span style={{ textAlign: 'right' }}>
              <Tip position="bottom" align="right" content={
                <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: '#58a6ff', marginBottom: 4 }}>Calls</div>
                  <div style={{ color: '#7d8590' }}>Total invocations in the selected period</div>
                </div>
              }>Calls</Tip>
            </span>
            <span style={{ textAlign: 'right' }}>
              <Tip position="bottom" align="right" content={
                <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: '#e3b341', marginBottom: 4 }}>Duration</div>
                  <div style={{ color: '#7d8590' }}>Cumulative execution time across all calls</div>
                </div>
              }>Duration</Tip>
            </span>
            <span>Trend</span>
            <span style={{ textAlign: 'right' }}>
              <Tip position="bottom" align="right" content={
                <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>Est. Cost</div>
                  <div style={{ color: '#7d8590' }}>Proportion of total session cost<br/>attributed to each tool by call count</div>
                </div>
              }>Est. Cost</Tip>
            </span>
          </div>

          {tools.map((t, i) => {
            const barWidth = sortBy === 'cost' ? t.estimatedCostUsd / maxCost
              : sortBy === 'count' ? t.count / maxCount
              : t.totalDurationMs / maxDuration
            return (
              <div key={`${t.tool}-${t.source}`} style={{
                display: 'grid', gridTemplateColumns: GRID_COLS,
                gap: 8, padding: '8px', fontSize: 12, color: '#e6edf3',
                background: '#161b22', border: '1px solid #21262d', borderRadius: 6,
                position: 'relative', overflow: 'hidden',
              }}>
                {/* Bar background */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  width: `${Math.max(barWidth * 100, 2)}%`,
                  background: `${COLORS[i % COLORS.length]}12`,
                  transition: 'width 0.3s ease',
                }} />
                <span style={{ color: '#8b949e', fontWeight: 600, position: 'relative' }}>{i + 1}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                  {t.tool === 'Other' ? (
                    <span
                      onClick={fetchOther}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                    >
                      <HelpCircle size={11} color="#8b949e" />
                      {t.tool}
                      {otherLoading ? <span style={{ fontSize: 9, color: '#484f58' }}>…</span>
                        : otherExpanded ? <ChevronUp size={10} color="#484f58" />
                        : <ChevronDown size={10} color="#484f58" />}
                    </span>
                  ) : (
                    <>
                      <Wrench size={11} color={COLORS[i % COLORS.length]} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.tool}>
                        {t.tool}
                      </span>
                      {sourceFilter === 'all' && (
                        <Tip position="top" align="left" content={
                          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                            <div style={{ fontWeight: 700, color: sourceColor(t.source), marginBottom: 4 }}>
                              {sourceLabel(t.source)}
                            </div>
                            <div style={{ color: '#7d8590' }}>This tool was invoked by {sourceLabel(t.source)}</div>
                          </div>
                        }>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '1px 5px', borderRadius: 3,
                            background: t.source === 'opencode' ? '#0d1f10' : '#0d1e33',
                            border: `1px solid ${sourceColor(t.source)}60`,
                            color: sourceColor(t.source),
                            cursor: 'default', whiteSpace: 'nowrap',
                          }}>
                            {sourceLabel(t.source)}
                          </span>
                        </Tip>
                      )}
                    </>
                  )}
                </span>
                 <span style={{ textAlign: 'right', color: '#8b949e', position: 'relative' }}>{t.tool === 'Other' ? '—' : t.count.toLocaleString()}</span>
                 <span style={{ textAlign: 'right', color: '#8b949e', position: 'relative' }}>{t.tool === 'Other' || t.totalDurationMs === 0 ? '—' : fmtDur(t.totalDurationMs)}</span>
                {t.tool === 'Other' ? <span /> : (
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <Sparkline data={(sparklines[t.tool] ?? []).map(d => d.calls)} color={COLORS[i % COLORS.length]} />
                  </span>
                )}
                <span style={{ textAlign: 'right', fontWeight: 600, color: COLORS[i % COLORS.length], position: 'relative' }}>{fmtCostPrecise(t.estimatedCostUsd)}</span>
              </div>
            )
          })}

          {/* Other breakdown */}
          {otherExpanded && otherTools.length > 0 && (
            <div style={{ marginLeft: 16, borderLeft: '2px solid #30363d', paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {otherTools.map((t, i) => (
                <div key={`${t.tool}-${t.source}-other`} style={{
                  display: 'grid', gridTemplateColumns: GRID_COLS,
                  gap: 8, padding: '5px 8px', fontSize: 11, color: '#8b949e',
                  background: '#0d1117', border: '1px solid #161b22', borderRadius: 4,
                }}>
                  <span style={{ color: '#484f58' }}>{i + 11}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <Wrench size={10} color="#484f58" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.tool}>{t.tool}</span>
                  </span>
                  <span style={{ textAlign: 'right' }}>{t.count.toLocaleString()}</span>
                  <span style={{ textAlign: 'right' }}>{t.totalDurationMs > 0 ? fmtDur(t.totalDurationMs) : '—'}</span>
                  <span />
                  <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCostPrecise(t.estimatedCostUsd)}</span>
                </div>
              ))}
              {otherTools.length === 0 && (
                <span style={{ fontSize: 11, color: '#484f58', padding: '4px 8px' }}>No additional tools in this period</span>
              )}
            </div>
          )}

          {/* Total row */}
          {(() => {
            const listed = tools.filter(t => t.tool !== 'Other')
            const totalCalls    = listed.reduce((s, t) => s + t.count, 0)
            const totalDuration = listed.reduce((s, t) => s + t.totalDurationMs, 0)
            const totalCost     = tools.reduce((s, t) => s + t.estimatedCostUsd, 0)
            return (
              <div style={{
                display: 'grid', gridTemplateColumns: GRID_COLS,
                gap: 8, padding: '8px', fontSize: 12,
                borderTop: '1px solid #30363d', marginTop: 2,
              }}>
                <span />
                <span style={{ color: '#8b949e', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center' }}>Total shown</span>
                <span style={{ textAlign: 'right', color: '#e6edf3', fontWeight: 600 }}>{totalCalls.toLocaleString()}</span>
                <span style={{ textAlign: 'right', color: '#e6edf3', fontWeight: 600 }}>{fmtDur(totalDuration)}</span>
                <span />
                <span style={{ textAlign: 'right', color: '#e6edf3', fontWeight: 700 }}>{fmtCostPrecise(totalCost)}</span>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function ProjectionCard({ label, tooltip, costSoFar, projected, daysWithData }: {
  label: string; tooltip: string; costSoFar: number; projected: number; daysWithData: number
}) {
  return (
    <div style={{
      flex: 1, background: '#161b22', border: '1px solid #21262d',
      borderRadius: 8, padding: '14px 16px',
    }}>
      <Tip position="top" align="left" content={
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>{label}</div>
          <div style={{ color: '#7d8590' }}>{tooltip}</div>
        </div>
      }>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', marginBottom: 8, cursor: 'default' }}>{label}</div>
      </Tip>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>{fmtCostPrecise(projected)}</span>
        <Tip position="top" align="left" content={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: '#58a6ff', marginBottom: 4 }}>Projected spend</div>
            <div style={{ color: '#7d8590' }}>Extrapolated from daily average based on {daysWithData.toFixed(1)} days of data</div>
          </div>
        }>
          <span style={{ fontSize: 11, color: '#8b949e', cursor: 'default' }}>projected</span>
        </Tip>
      </div>
      <div style={{ fontSize: 11, color: '#484f58' }}>
        {fmtCostPrecise(costSoFar)} spent over {daysWithData.toFixed(1)} days
      </div>
    </div>
  )
}
