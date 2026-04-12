import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { CostInfo, DayStats } from '../types'

interface Props {
  cost?:      CostInfo
  weeklyData: DayStats[]
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const S = {
  footer: {
    background: '#161b22',
    borderTop: '1px solid #21262d',
    padding: '8px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    minHeight: 52,
  } as React.CSSProperties,
  group: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  label: { color: '#7d8590', fontSize: 11 } as React.CSSProperties,
  value: { color: '#e6edf3', fontWeight: 700, fontSize: 13 } as React.CSSProperties,
  sep:   { color: '#21262d', userSelect: 'none' as const },
  badge: (color: string): React.CSSProperties => ({
    background: color + '22', color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 700,
  }),
  barWrap: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
}

export function StatsFooter({ cost, weeklyData }: Props) {
  const score = cost
    ? (cost.efficiency_score === 0 && cost.cost_usd < 0.001 ? 100 : cost.efficiency_score)
    : null

  const scoreColor = score === null ? '#7d8590'
    : score >= 90 ? '#3fb950'
    : score >= 70 ? '#d29922'
    : '#f85149'

  const totalWeekly = weeklyData.reduce((s, d) => s + d.tokens, 0)

  return (
    <div style={S.footer}>
      {/* Costo */}
      {cost && cost.cost_usd > 0 ? (
        <>
          <div style={S.group}>
            <span style={S.label}>💰 coste</span>
            <span style={S.badge('#3fb950')}>${cost.cost_usd.toFixed(4)}</span>
          </div>

          <span style={S.sep}>│</span>

          <div style={S.group}>
            <span style={S.label}>↑</span>
            <span style={S.value}>{fmtTok(cost.input_tokens)}</span>
            <span style={S.label}>↓</span>
            <span style={S.value}>{fmtTok(cost.output_tokens)}</span>
            <span style={S.label}>🗄</span>
            <span style={S.value}>{fmtTok(cost.cache_read)}</span>
          </div>

          <span style={S.sep}>│</span>

          <div style={S.group}>
            <span style={S.label}>eficiencia</span>
            <ScoreBar score={score ?? 100} color={scoreColor} />
            <span style={{ ...S.badge(scoreColor), minWidth: 44, textAlign: 'center' }}>
              {score}/100
            </span>
          </div>
        </>
      ) : (
        <div style={S.group}>
          <span style={S.label}>💰 calculando coste…</span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Weekly bar */}
      {weeklyData.length > 0 && (
        <div style={S.barWrap}>
          <span style={S.label}>semanal</span>
          <div style={{ width: 120, height: 32 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#7d8590' }}
                  itemStyle={{ color: '#58a6ff' }}
                  formatter={(v: number) => [fmtTok(v), 'tokens']}
                />
                <Bar dataKey="tokens" radius={[2,2,0,0]}>
                  {weeklyData.map((_, i) => (
                    <Cell key={i} fill={i === weeklyData.length - 1 ? '#3fb950' : '#1f6feb'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={{ ...S.value, fontSize: 12 }}>{fmtTok(totalWeekly)}</div>
            <div style={{ ...S.label, fontSize: 10 }}>tokens / 7 días</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ width: 80, height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${score}%`, height: '100%',
        background: color,
        borderRadius: 3,
        transition: 'width 0.5s ease',
        boxShadow: `0 0 4px ${color}88`,
      }} />
    </div>
  )
}
