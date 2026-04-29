import { BarChart, Bar, ResponsiveContainer, Cell, Tooltip as RechartsTip } from 'recharts'
import { Bot, Flame, Activity } from 'lucide-react'
import type { CostInfo, DayStats, SubAgentSession } from '../../types'
import type { TraceEvent } from '../../types'
import { Tip } from '../Tip'
import {
  fmtUsd, fmtTok, estimateCacheSavings,
  EFFICIENCY_ALERT_COLOR,
} from './utils'
import type { HiddenCostStats, SessionPromptItem } from './utils'
import { AnimatedCost, EfficiencyAlert } from './SidebarKPI'

export function SidebarStats({ cost, weeklyData, events, hiddenCost, prompts = [], subAgentSessions = [] }: {
  cost?:              CostInfo
  weeklyData:         DayStats[]
  events:             TraceEvent[]
  hiddenCost?:        HiddenCostStats
  prompts?:           SessionPromptItem[]
  subAgentSessions?:  SubAgentSession[]
}) {
  const score = cost
    ? (cost.efficiency_score === 0 && cost.cost_usd < 0.001 ? 100 : cost.efficiency_score)
    : null
  const scoreColor = score === null ? '#484f58'
    : score >= 90 ? '#3fb950' : score >= 70 ? '#d29922' : '#f85149'
  const savings = cost ? estimateCacheSavings(cost.cache_read, cost.model) : 0
  const totalWeekly = weeklyData.reduce((s, d) => s + d.tokens, 0)

  if (!cost && weeklyData.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid #21262d', flexShrink: 0, padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 6, background: '#090d12' }}>

      {cost && cost.cost_usd > 0 && (
        <>
          {/* Cost + tokens */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Tip position="top" align="left" content={
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>Session cost</div>
                <div style={{ color: '#7d8590' }}>Total accumulated since the start of this session.</div>
                <div style={{ color: '#484f58', marginTop: 6 }}>
                  <div>Input: {fmtTok(cost.input_tokens)} tokens</div>
                  <div>Output: {fmtTok(cost.output_tokens)} tokens</div>
                  {cost.cache_read > 0 && <div>Cache: {fmtTok(cost.cache_read)} tokens</div>}
                </div>
              </div>
            }>
              <span style={{ background: '#3fb95022', color: '#3fb950', border: '1px solid #3fb95044',
                borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0, cursor: 'default' }}>
                <AnimatedCost usd={cost.cost_usd} />
              </span>
            </Tip>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(cost.input_tokens)} in</span>
            <span style={{ color: '#30363d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(cost.output_tokens)} out</span>
            {cost.cache_read > 0 && (
              <>
                <span style={{ color: '#30363d', fontSize: 10 }}>·</span>
                <span style={{ fontSize: 10, color: '#3fb95099' }}>{fmtTok(cost.cache_read)} cache</span>
              </>
            )}
          </div>
          {savings >= 0.001 && (
            <Tip position="top" align="left" content={
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>Cache savings</div>
                <div style={{ color: '#7d8590' }}>Estimated money saved by tokens read from cache instead of being reprocessed.</div>
                <div style={{ color: '#484f58', marginTop: 6 }}>{fmtTok(cost.cache_read)} tokens from cache</div>
              </div>
            }>
              <div style={{ fontSize: 9, color: '#3fb95088', cursor: 'default' }}>~{fmtUsd(savings)} saved via cache</div>
            </Tip>
          )}
          {/* Efficiency */}
          {score !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tip position="top" align="left" content={
                  <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 700, color: scoreColor, marginBottom: 4 }}>Efficiency score</div>
                    <div style={{ color: '#7d8590' }}>Measures how well context is used. Penalizes loops, long sessions, and high context usage.</div>
                    <div style={{ color: '#484f58', marginTop: 6 }}>
                      <div>≥ 90 → efficient</div>
                      <div>70–90 → acceptable</div>
                      <div>&lt; 70 → inefficient</div>
                    </div>
                  </div>
                }>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'default' }}>
                    <Activity size={9} color="#484f58" />
                    <span style={{ fontSize: 9, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>efficiency</span>
                  </div>
                </Tip>
                <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${score}%`, height: '100%', background: scoreColor,
                    borderRadius: 2, transition: 'width 0.5s', boxShadow: `0 0 3px ${scoreColor}88` }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor }}>{score}</span>
              </div>

              {score !== null && score < 70 && cost && <EfficiencyAlert cost={cost} events={events} prompts={prompts} />}
            </div>
          )}
        </>
      )}

      {/* Weekly chart */}
      {weeklyData.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 28 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <RechartsTip
                  contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, fontSize: 10 }}
                  formatter={(v: number) => [fmtTok(v), 'tokens']}
                />
                <Bar dataKey="tokens" radius={[2, 2, 0, 0]}>
                  {weeklyData.map((_, i) => (
                    <Cell key={i} fill={i === weeklyData.length - 1 ? '#3fb950' : '#1f6feb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 11 }}>{fmtTok(totalWeekly)}</div>
            <div style={{ color: '#484f58', fontSize: 9 }}>7 days</div>
          </div>
        </div>
      )}

      {/* Coste oculto semanal */}
      {hiddenCost && hiddenCost.total_loops > 0 && (
        <div style={{
          borderTop: '1px solid #21262d', paddingTop: 6, marginTop: 2,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <Tip position="top" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#d29922', marginBottom: 4 }}>Hidden cost in loops</div>
              <div style={{ color: '#7d8590' }}>Estimate of money lost to unnecessary tool repetitions.</div>
              <div style={{ color: '#484f58', marginTop: 6 }}>
                <div>{hiddenCost.loop_sessions} sessions with loops detected</div>
                <div>{hiddenCost.total_loops} loops · {hiddenCost.total_sessions} total sessions</div>
                <div style={{ marginTop: 4 }}>Formula: <span style={{ color: '#7d8590', fontFamily: 'monospace', fontSize: 10 }}>cost × (loops / tool_calls)</span></div>
              </div>
            </div>
          }>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
              <Flame size={9} color="#d29922" />
              <span style={{ fontSize: 9, color: '#7d8590', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>hidden cost 7d</span>
            </div>
          </Tip>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              background: '#3d2600', color: '#d29922', border: '1px solid #d2992244',
              borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700,
            }}>
              ~{fmtUsd(hiddenCost.loop_waste_usd)}
            </span>
            <span style={{ fontSize: 9, color: '#484f58' }}>lost in loops</span>
          </div>
          <div style={{ fontSize: 9, color: '#3d444d' }}>
            {hiddenCost.total_loops} loop{hiddenCost.total_loops > 1 ? 's' : ''} · {hiddenCost.loop_sessions}/{hiddenCost.total_sessions} sesiones
          </div>
        </div>
      )}

      {/* Sub-agent sessions */}
      {subAgentSessions.length > 0 && (
        <div style={{ borderTop: '1px solid #21262d', paddingTop: 6, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Bot size={9} color="#bc8cff" />
            <span style={{ fontSize: 9, color: '#7d8590', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sub-agentes</span>
          </div>
          {subAgentSessions.map(s => {
            const m = s.dominant_model
            const mColor = m?.includes('opus') ? '#d29922' : m?.includes('haiku') ? '#3fb950' : '#58a6ff'
            const mLabel = m?.includes('opus') ? 'Opus' : m?.includes('haiku') ? 'Haiku' : 'Sonnet'
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, color: mColor, background: mColor + '18', border: `1px solid ${mColor}30`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                  {mLabel}
                </span>
                {(s.total_cost_usd ?? 0) > 0 && (
                  <span style={{ fontSize: 10, color: '#6e7681', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtUsd(s.total_cost_usd!)}
                  </span>
                )}
              </div>
            )
          })}
          {subAgentSessions.length > 1 && (
            <div style={{ fontSize: 9, color: '#484f58' }}>
              total sub-agentes {fmtUsd(subAgentSessions.reduce((s, a) => s + (a.total_cost_usd ?? 0), 0))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
