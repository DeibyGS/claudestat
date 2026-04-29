import { BarChart2 } from 'lucide-react'
import type { QuotaData } from '../../../types'
import { Tip } from '../../Tip'
import { PRICE_PER_M, fmtTok, fmtUsd } from '../utils'
import { Card, CardHeader } from './StatusCard'

// ─── Card: Modelos esta semana ─────────────────────────────────────────────────

export function ModelCard({ quota }: { quota: QuotaData }) {
  const rows = [
    { label: 'Sonnet', color: '#58a6ff', hours: quota.weeklyHoursSonnet, limit: quota.weeklyLimitSonnet, tokens: quota.weeklyTokensSonnet ?? 0, price: PRICE_PER_M.sonnet },
    { label: 'Haiku',  color: '#3fb950', hours: quota.weeklyHoursHaiku,  limit: 0,                       tokens: quota.weeklyTokensHaiku  ?? 0, price: PRICE_PER_M.haiku  },
    { label: 'Opus',   color: '#d29922', hours: quota.weeklyHoursOpus,   limit: quota.weeklyLimitOpus,   tokens: quota.weeklyTokensOpus   ?? 0, price: PRICE_PER_M.opus   },
  ].filter(r => r.hours > 0 || r.tokens > 0)

  const totalCost = rows.reduce((s, r) => s + (r.tokens / 1_000_000) * r.price, 0)
  const totalTok  = rows.reduce((s, r) => s + r.tokens, 0)

  return (
    <Card>
      <CardHeader icon={BarChart2} title="Models this week" />
      {rows.length === 0 ? (
        <span style={{ fontSize: 12, color: '#484f58' }}>No activity this week</span>
      ) : (
        <>
          {rows.map(r => {
            const pct     = r.limit > 0 ? Math.min(100, (r.hours / r.limit) * 100) : 0
            const estCost = (r.tokens / 1_000_000) * r.price
            const tokPct  = totalTok > 0 ? Math.round((r.tokens / totalTok) * 100) : 0
            return (
              <div key={r.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Tip position="bottom" align="left" content={
                    <div>
                      <div style={{ color: r.color, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{r.label}</div>
                      <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                        Estimated price: ~${r.price}/M tokens (blended input/output)<br />
                        Hours = 5 min windows where Claude used this model<br />
                        {r.limit > 0 ? `Max weekly limit: ${r.limit}h` : 'No weekly limit configured'}
                      </div>
                    </div>
                  }><span style={{ width: 46, fontSize: 11, color: r.color, fontWeight: 700, flexShrink: 0, cursor: 'help' }}>{r.label}</span></Tip>
                  <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>{r.hours > 0 ? `${r.hours}h` : '—'}</span>
                  {r.limit > 0 && <span style={{ fontSize: 10, color: '#484f58' }}>/ {r.limit}h</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(r.tokens)}</span>
                  <span style={{ fontSize: 10, color: '#3d444d' }}>·</span>
                  <span style={{ fontSize: 10, color: '#484f58' }}>{tokPct}%</span>
                  <span style={{ fontSize: 10, color: '#3fb950', marginLeft: 4 }}>~{fmtUsd(estCost)}</span>
                </div>
                {r.limit > 0 && r.hours > 0 && (
                  <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : r.color, borderRadius: 2 }} />
                  </div>
                )}
                {r.limit === 0 && r.tokens > 0 && (
                  <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${tokPct}%`, height: '100%', background: r.color + 'aa', borderRadius: 2 }} />
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid #21262d', paddingTop: 8, marginTop: 4, display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>{fmtTok(totalTok)} tokens</div>
              <div style={{ fontSize: 9, color: '#484f58' }}>total week</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#3fb950' }}>~{fmtUsd(totalCost)}</div>
              <div style={{ fontSize: 9, color: '#484f58' }}>estimated cost</div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: '#3d444d', marginTop: 6 }}>
            Hours = 5 min active windows · Tokens = input + output · Estimated blended price
          </div>
        </>
      )}
    </Card>
  )
}
