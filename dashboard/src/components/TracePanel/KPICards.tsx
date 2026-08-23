import { BrainCircuit, ArrowDownLeft, DollarSign, Boxes } from 'lucide-react'
import { BarChart, Bar, Cell, AreaChart, Area, ReferenceLine, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import type { CostInfo, BlockCost, SessionState } from '../../types'
import { Tip } from '../Tip'
import { fmtUsd, fmtTok } from './utils'

const COMPACT_THRESHOLD = 0.85

function KPICard({ icon: Icon, iconColor, label, value, barPct, barColor, tooltip, sub, children }: {
  icon:       typeof BrainCircuit
  iconColor:  string
  label:      string
  value:      string
  barPct:     number | null
  barColor:   string
  tooltip:    React.ReactNode
  sub?:       string
  children?:  React.ReactNode
}) {
  return (
    <Tip position="bottom" align="left" content={tooltip}>
      <div style={{
        background: '#0d1117', border: '1px solid #21262d', borderRadius: 8,
        padding: '10px 14px', cursor: 'default',
        display: 'flex', flexDirection: 'column', gap: 6,
        width: '100%', height: '100%', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={12} color={iconColor} />
          <span style={{ fontSize: 10, color: '#7d8590', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {value}
        </div>
        {children ?? (
          <div style={{ height: 4, background: '#161b22', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: barPct !== null ? `${Math.min(100, barPct)}%` : '0%', height: '100%',
              background: barColor, borderRadius: 2, transition: 'width 0.5s',
            }} />
          </div>
        )}
        <div style={{ fontSize: 9, color: '#484f58', minHeight: 12 }}>
          {sub ?? '\u00A0'}
        </div>
      </div>
    </Tip>
  )
}

export function KPICards({ cost, promptCount, blockCosts = [], sessionState = 'idle', burnRateTokensPerMin }: {
  cost?:                  CostInfo
  promptCount?:           number
  blockCosts?:            BlockCost[]
  sessionState?:          SessionState
  burnRateTokensPerMin?:  number
}) {
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100)) : null
  const ctxFree  = contextPct !== null ? 100 - contextPct : null
  const ctxColor = ctxFree === null ? '#484f58'
    : ctxFree < 15 ? '#f85149' : ctxFree < 35 ? '#d29922' : '#3fb950'

  const MSG_SOFT_LIMIT = 20
  const msgPct  = promptCount ? Math.min(100, Math.round(promptCount / MSG_SOFT_LIMIT * 100)) : null
  const msgColor = !promptCount ? '#484f58'
    : promptCount < 15 ? '#3fb950' : promptCount < 20 ? '#d29922' : '#f85149'

  const rate = burnRateTokensPerMin ?? 0
  const showCost = cost && cost.cost_usd > 0

  const lastBlockCost = blockCosts.length > 0 ? blockCosts[blockCosts.length - 1] : null
  const lastBlockUsd = lastBlockCost ? (lastBlockCost.inputUsd ?? 0) + (lastBlockCost.outputUsd ?? 0) : 0
  const avgBlockUsd = blockCosts.length > 0
    ? blockCosts.reduce((s, b) => s + ((b.inputUsd ?? 0) + (b.outputUsd ?? 0)), 0) / blockCosts.length
    : 0
  const blockBarPct = avgBlockUsd > 0 && lastBlockUsd > 0
    ? Math.min(100, Math.round(lastBlockUsd / avgBlockUsd * 100))
    : null
  const blockColor = lastBlockUsd > avgBlockUsd * 1.5 ? '#f85149'
    : lastBlockUsd > avgBlockUsd * 1.1 ? '#d29922'
    : '#58a6ff'

  const MAX_BLOCKS = 20
  const barData = blockCosts.slice(-MAX_BLOCKS).map((b, i) => ({
    idx: blockCosts.length - MAX_BLOCKS + i,
    cost: (b.inputUsd ?? 0) + (b.outputUsd ?? 0),
    inputTokens: b.inputTokens ?? 0,
    outputTokens: b.outputTokens ?? 0,
  }))
  const hasBarData = barData.length > 0 && barData.some(d => d.cost > 0)

  const ctxData = blockCosts.slice(-MAX_BLOCKS).map((b, i) => {
    if (!b.context_used || !b.context_window || b.context_window === 0) return null
    const pct = Math.min(100, Math.round(b.context_used / (b.context_window * COMPACT_THRESHOLD) * 100))
    return { idx: blockCosts.length - MAX_BLOCKS + i, pct, used: b.context_used, window: b.context_window }
  }).filter(Boolean) as { idx: number; pct: number; used: number; window: number }[]
  const hasCtxData = ctxData.length >= 2
  const lastCtxPct = ctxData.length > 0 ? ctxData[ctxData.length - 1].pct : 0
  const ctxLineColor = lastCtxPct >= 80 ? '#f85149' : lastCtxPct >= 50 ? '#d29922' : '#3fb950'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
      padding: '10px 24px', flexShrink: 0,
    }}>
      <KPICard
        icon={BrainCircuit}
        iconColor={ctxColor}
        label="Context"
        value={ctxFree !== null ? `${ctxFree}% free` : '—'}
        barPct={contextPct}
        barColor={ctxColor}
        sub={cost?.context_used ? `${fmtTok(cost.context_used)} used` : undefined}
        tooltip={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: ctxColor, marginBottom: 4 }}>Context window</div>
            <div style={{ color: '#7d8590' }}>% calculated over auto-compact threshold (~85% of total window)</div>
            <div style={{ color: '#484f58', marginTop: 6, fontSize: 10 }}>
              Total: <span style={{ color: '#e6edf3' }}>{fmtTok(cost?.context_window ?? 200_000)}</span>
              {'  ·  '}Threshold: <span style={{ color: '#e6edf3' }}>{fmtTok(compactWindow ?? 170_000)}</span>
            </div>
          </div>
        }
      >
        {hasCtxData && (
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={ctxData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <ReferenceLine y={100} stroke="#f8514944" strokeDasharray="3 3" />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as typeof ctxData[0]
                  return (
                    <div style={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, padding: '5px 8px', fontSize: 10, color: '#c9d1d9', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: ctxLineColor }}>Block #{d.idx} — {d.pct}%</div>
                      <div style={{ color: '#8b949e' }}>{fmtTok(d.used)} / {fmtTok(d.window)}</div>
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="pct" stroke={ctxLineColor} fill={ctxLineColor + '20'} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </KPICard>

      <KPICard
        icon={ArrowDownLeft}
        iconColor={msgColor}
        label="Messages"
        value={promptCount ? String(promptCount) : '—'}
        barPct={msgPct}
        barColor={msgColor}
        sub={promptCount ? `of ${MSG_SOFT_LIMIT} soft limit` : undefined}
        tooltip={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: msgColor, marginBottom: 4 }}>Session messages</div>
            <div style={{ color: '#7d8590' }}>Number of user turns in this session.</div>
            <div style={{ color: '#484f58', marginTop: 6 }}>
              <div>Reference: &lt;15 normal · 15-20 heavy · &gt;20 very long session</div>
            </div>
          </div>
        }
      />

      <KPICard
        icon={DollarSign}
        iconColor={showCost ? '#3fb950' : '#484f58'}
        label="Cost"
        value={showCost ? fmtUsd(cost!.cost_usd) : '—'}
        barPct={null}
        barColor="#3fb950"
        sub={rate > 0 ? `${rate.toLocaleString()} tok/min` : undefined}
        tooltip={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>Session cost</div>
            <div style={{ color: '#7d8590' }}>Total accumulated since the start of this session.</div>
            {showCost && (
              <div style={{ color: '#484f58', marginTop: 6 }}>
                <div>Input: {fmtTok(cost!.input_tokens)} tokens</div>
                <div>Output: {fmtTok(cost!.output_tokens)} tokens</div>
                {cost!.cache_read > 0 && <div>Cache: {fmtTok(cost!.cache_read)} tokens</div>}
              </div>
            )}
            {cost?.projected_hourly_usd && cost.projected_hourly_usd > 0.001 && cost.projected_hourly_usd < 50 && (
              <div style={{ color: '#d29922', marginTop: 4 }}>
                Projection: ~{fmtUsd(cost.projected_hourly_usd)}/h at current rate
              </div>
            )}
          </div>
        }
      />

      <KPICard
        icon={Boxes}
        iconColor={blockColor}
        label="Cost/block"
        value={lastBlockUsd > 0 ? fmtUsd(lastBlockUsd) : '—'}
        barPct={blockBarPct}
        barColor={blockColor}
        sub={blockCosts.length > 1 ? `avg ${fmtUsd(avgBlockUsd)}` : undefined}
        tooltip={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: blockColor, marginBottom: 4 }}>Cost per block</div>
            <div style={{ color: '#7d8590' }}>Cost of the last completed tool block.</div>
            <div style={{ color: '#484f58', marginTop: 6 }}>
              <div>Last: {fmtUsd(lastBlockUsd)}</div>
              {blockCosts.length > 1 && <div>Average: {fmtUsd(avgBlockUsd)}</div>}
              <div>Blocks: {blockCosts.length}</div>
            </div>
            {lastBlockCost && (
              <div style={{ marginTop: 4, borderTop: '1px solid #21262d', paddingTop: 4 }}>
                <div>Input: {fmtTok(lastBlockCost.inputTokens ?? 0)} tokens</div>
                <div>Output: {fmtTok(lastBlockCost.outputTokens ?? 0)} tokens</div>
                {lastBlockCost.cacheRead != null && lastBlockCost.cacheRead > 0 && (
                  <div>Cache: {fmtTok(lastBlockCost.cacheRead)} tokens</div>
                )}
              </div>
            )}
          </div>
        }
      >
        {hasBarData && (
          <ResponsiveContainer width="100%" height={40}>
            <BarChart data={barData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as typeof barData[0]
                  return (
                    <div style={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, padding: '5px 8px', fontSize: 10, color: '#c9d1d9', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, color: d.cost > avgBlockUsd * 1.5 ? '#f85149' : '#58a6ff' }}>Block #{d.idx} — {fmtUsd(d.cost)}</div>
                      <div style={{ color: '#8b949e' }}>
                        <span style={{ color: '#79c0ff' }}>In</span> {fmtTok(d.inputTokens)} · <span style={{ color: '#56d364' }}>Out</span> {fmtTok(d.outputTokens)}
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="cost" radius={[2, 2, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.cost > avgBlockUsd * 1.5 ? '#f85149' : entry.cost > avgBlockUsd * 1.1 ? '#d29922' : '#1f6feb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </KPICard>
    </div>
  )
}
