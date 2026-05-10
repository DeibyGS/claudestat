import { useEffect, useState } from 'react'
import { Wrench, DollarSign, Clock, Hash, HelpCircle } from 'lucide-react'
import { Tip } from './Tip'

interface TopTool {
  tool:           string
  count:          number
  totalDurationMs: number
  estimatedCostUsd: number
  pctCost:        number
  pctCount:       number
}

interface TopData {
  by:   string
  days: number
  tools: TopTool[]
}

interface CostProjection {
  weekly:  { daysWithData: number; costSoFar: number; projected: number }
  monthly: { daysWithData: number; costSoFar: number; projected: number }
}

type SortBy = 'cost' | 'count' | 'duration'

function fmtCost(n: number): string {
  if (n < 0.001) return '$0'
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

export function TopView() {
  const [data, setData] = useState<TopData | undefined>()
  const [projection, setProjection] = useState<CostProjection | undefined>()
  const [sortBy, setSortBy] = useState<SortBy>('cost')
  const [days, setDays] = useState(30)

  useEffect(() => {
    fetch(`/api/top?by=${sortBy}&limit=10&days=${days}`)
      .then(r => r.ok ? r.json() : undefined)
      .then(d => d && setData(d))
      .catch(() => {})

    fetch('/cost-projection')
      .then(r => r.ok ? r.json() : undefined)
      .then(d => d && setProjection(d))
      .catch(() => {})
  }, [sortBy, days])

  const tools = data?.tools ?? []
  const maxCost = Math.max(...tools.map(t => t.estimatedCostUsd), 0.001)
  const maxCount = Math.max(...tools.map(t => t.count), 1)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 24px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e6edf3' }}>
          Tool Rankings
        </h2>

        {/* Sort buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          {([
            { key: 'cost',     label: 'Cost',     icon: DollarSign, color: '#3fb950', tip: "Estimated USD cost per tool, calculated from each tool's share of total token usage" },
            { key: 'count',    label: 'Calls',    icon: Hash,        color: '#58a6ff', tip: 'Total number of invocations in the selected period' },
            { key: 'duration', label: 'Duration', icon: Clock,       color: '#e3b341', tip: 'Cumulative execution time (sum of all calls)' },
          ] as const).map(({ key, label, icon: Icon, color, tip }) => (
            <Tip key={key} position="bottom" align="left" content={
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color, marginBottom: 4 }}>Sort by {label.toLowerCase()}</div>
                <div style={{ color: '#7d8590' }}>{tip}</div>
              </div>
            }>
              <button
                onClick={() => setSortBy(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', fontSize: 11, fontWeight: sortBy === key ? 600 : 400,
                  color: sortBy === key ? '#e6edf3' : '#8b949e',
                  background: sortBy === key ? '#21262d' : 'transparent',
                  border: `1px solid ${sortBy === key ? '#30363d' : 'transparent'}`,
                  borderRadius: 5, cursor: 'pointer',
                }}
              >
                <Icon size={11} /> {label}
              </button>
            </Tip>
          ))}
        </div>

        {/* Days selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 8px', fontSize: 11, fontWeight: days === d ? 600 : 400,
                color: days === d ? '#e6edf3' : '#8b949e',
                background: days === d ? '#21262d' : 'transparent',
                border: `1px solid ${days === d ? '#30363d' : 'transparent'}`,
                borderRadius: 5, cursor: 'pointer',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
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
          No tool usage data for this period.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '32px 140px 70px 80px 80px',
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
              : t.totalDurationMs / (Math.max(...tools.map(x => x.totalDurationMs), 1))
            return (
              <div key={t.tool} style={{
                display: 'grid', gridTemplateColumns: '32px 140px 70px 80px 80px',
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
                    <Tip position="top" align="left" content={
                      <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 700, color: '#8b949e', marginBottom: 4 }}>Other tools</div>
                        <div style={{ color: '#7d8590' }}>Remaining cost not attributed to the<br/>top tools listed above</div>
                      </div>
                    }>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HelpCircle size={11} color="#8b949e" />
                        {t.tool}
                      </span>
                    </Tip>
                  ) : (
                    <><Wrench size={11} color={COLORS[i % COLORS.length]} />{t.tool}</>
                  )}
                </span>
                 <span style={{ textAlign: 'right', color: '#8b949e', position: 'relative' }}>{t.tool === 'Other' ? '—' : t.count.toLocaleString()}</span>
                 <span style={{ textAlign: 'right', color: '#8b949e', position: 'relative' }}>{t.tool === 'Other' ? '—' : fmtDur(t.totalDurationMs)}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: COLORS[i % COLORS.length], position: 'relative' }}>{fmtCost(t.estimatedCostUsd)}</span>
              </div>
            )
          })}
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
        <span style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>{fmtCost(projected)}</span>
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
        {fmtCost(costSoFar)} spent over {daysWithData.toFixed(1)} days
      </div>
    </div>
  )
}
