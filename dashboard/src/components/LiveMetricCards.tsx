import React, { useEffect, useState } from 'react'

interface TurnMetric {
  ts: number
  cost_usd?: number | null
  priced?: boolean
}

interface CompactionMetric {
  ts: number
  pre_tokens?: number | null
}

interface TurnTotals {
  lines_added: number | null
  lines_removed: number | null
  api_ms: number | null
  tool_ms: number | null
  thinking_tokens_est: number | null
  compactions: CompactionMetric[]
}

export interface SessionTurns {
  turns: TurnMetric[]
  totals: TurnTotals
}

const count = (value: number) => value.toLocaleString('en-US')
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
const money = (value: number) => `$${value.toFixed(4)}`
const turnCost = (turn: TurnMetric) => turn.priced && turn.cost_usd != null ? turn.cost_usd : null

function TurnSparkline({ turns }: { turns: TurnMetric[] }) {
  const recent = turns.slice(-40)
  const costs = recent.map(turnCost)
  const known = costs.filter((cost): cost is number => cost !== null)
  if (recent.length === 0) return <div className="cs-metric-note">—</div>
  const max = Math.max(...known, 0.000001)
  const x = (index: number) => 4 + index * 192 / Math.max(1, recent.length - 1)
  const y = (cost: number) => 30 - cost / max * 26
  return (
    <svg viewBox="0 0 200 34" className="cs-turn-sparkline" role="img" aria-label="Cost per turn; gaps indicate unpriced turns">
      {costs.map((cost, index) => {
        const label = `Turn ${turns.length - recent.length + index + 1}: ${cost === null ? '—' : money(cost)}`
        if (cost === null) return <title key={index}>{label}</title>
        const previous = costs[index - 1]
        return (
          <g key={index}>
            <title>{label}</title>
            {previous != null && <line x1={x(index - 1)} y1={y(previous)} x2={x(index)} y2={y(cost)} stroke="currentColor" strokeWidth="1.5" />}
            <circle cx={x(index)} cy={y(cost)} r="2" fill="currentColor" />
          </g>
        )
      })}
    </svg>
  )
}

export function MetricCards({ data }: { data?: SessionTurns }) {
  const totals = data?.totals
  const hasTurns = !!data?.turns.length
  const api = hasTurns ? totals?.api_ms : null
  const tool = hasTurns ? totals?.tool_ms : null
  const timed = api != null && tool != null && api + tool > 0
  const apiPct = timed ? Math.round(api / (api + tool) * 100) : null
  const latestCompaction = totals?.compactions.reduce<CompactionMetric | undefined>(
    (latest, item) => !latest || item.ts > latest.ts ? item : latest, undefined,
  )
  const turns = data?.turns ?? []
  const latestCost = turns.length ? turnCost(turns[turns.length - 1]) : null
  const unpriced = turns.filter(turn => turnCost(turn) === null).length

  return (
    <div className="cs-metric-grid">
      <div className="cs-metric-card">
        <h3>Lines changed</h3>
        <div className="cs-metric-value">
          <span style={{ color: 'var(--ok)' }}>{totals?.lines_added == null ? '—' : `+${count(totals.lines_added)}`}</span>
          {' / '}
          <span style={{ color: 'var(--crit)' }}>{totals?.lines_removed == null ? '—' : `−${count(totals.lines_removed)}`}</span>
        </div>
        <div className="cs-metric-note">Added / removed · session</div>
      </div>
      <div className="cs-metric-card">
        <h3>API vs tools</h3>
        <div className="cs-metric-value">{api == null ? '—' : duration(api)} / {tool == null ? '—' : duration(tool)}</div>
        {apiPct !== null && (
          <div className="cs-time-split" role="img" aria-label={`API ${apiPct}%, tools ${100 - apiPct}%`}>
            <span style={{ width: `${apiPct}%` }} />
          </div>
        )}
        <div className="cs-metric-note">API / tool time{apiPct === null ? '' : ` · ${apiPct}% API`}</div>
      </div>
      <div className="cs-metric-card">
        <h3>Thinking tokens</h3>
        <div className="cs-metric-value">{totals?.thinking_tokens_est == null ? '—' : `≈${count(totals.thinking_tokens_est)}`}</div>
        <div className="cs-metric-note">Session reasoning · CC estimated</div>
      </div>
      <div className="cs-metric-card">
        <h3>Compactions</h3>
        <div className="cs-metric-value">{totals ? count(totals.compactions.length) : '—'}</div>
        <div className="cs-metric-note">Last pre-tokens: {latestCompaction?.pre_tokens == null ? '—' : count(latestCompaction.pre_tokens)}</div>
      </div>
      <div className="cs-metric-card">
        <h3>Cost per turn</h3>
        <div className="cs-metric-value">{latestCost === null ? '—' : money(latestCost)}</div>
        <TurnSparkline turns={turns} />
        <div className="cs-metric-note">{data ? `${count(turns.length)} turns · ${count(unpriced)} unpriced` : '—'}</div>
      </div>
    </div>
  )
}

export function LiveMetricCards({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; data?: SessionTurns; error: boolean }>()

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, { signal: controller.signal })
        if (!response.ok) throw new Error('Metrics unavailable')
        const data: SessionTurns = await response.json()
        if (!controller.signal.aborted) setSnapshot({ sessionId, data, error: false })
      } catch {
        if (!controller.signal.aborted) setSnapshot({ sessionId, error: true })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])

  const current = snapshot?.sessionId === sessionId ? snapshot : undefined
  return (
    <section className="cs-live-metrics" aria-label="Session metrics" aria-busy={!current}>
      <style>{`
        .cs-live-metrics { flex-shrink: 0; padding: 8px 24px; max-height: 32vh; overflow-y: auto; border-bottom: 1px solid var(--line) }
        .cs-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(155px, 100%), 1fr)); gap: 8px }
        .cs-metric-card { min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel) }
        .cs-metric-card h3 { margin: 0 0 8px; color: var(--muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em }
        .cs-metric-value { color: var(--text); font-size: 16px; font-weight: 700; overflow-wrap: anywhere }
        .cs-metric-note { margin-top: 6px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere }
        .cs-time-split { height: 4px; margin-top: 7px; border-radius: 2px; background: var(--ok); overflow: hidden }
        .cs-time-split span { display: block; height: 100%; background: var(--accent) }
        .cs-turn-sparkline { display: block; width: 100%; height: 34px; color: var(--accent); margin-top: 4px }
        .cs-metric-status { color: var(--muted); font-size: 10px; margin-bottom: 6px }
        @media (max-width: 900px) { .cs-live-metrics { padding: 8px 12px } }
      `}</style>
      {(!current || current.error) && <div className="cs-metric-status" role="status">{current?.error ? 'Metrics unavailable · retrying…' : 'Loading metrics…'}</div>}
      <MetricCards data={current?.data} />
    </section>
  )
}
