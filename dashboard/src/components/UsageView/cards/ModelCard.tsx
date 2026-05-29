import { BarChart2 } from 'lucide-react'
import type { QuotaData } from '../../../types'
import { Tip } from '../../Tip'
import { PRICE_PER_M, fmtTok, fmtUsd } from '../utils'
import { Card, CardHeader } from './StatusCard'

const MODEL_PALETTE = [
  '#58a6ff', '#3fb950', '#d29922', '#c9a0ff', '#f0883e',
  '#79c0ff', '#56d364', '#e3b341', '#bc8cff', '#f85149',
  '#74aa9c', '#8b5cf6', '#ff7b72',
]

function modelColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i)
  return MODEL_PALETTE[Math.abs(hash) % MODEL_PALETTE.length]
}

function shortModel(m: string): string {
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/^opencode-go\//, '')
}

function ccModelKey(m: string): string | undefined {
  const l = m.toLowerCase()
  if (l.includes('sonnet')) return 'sonnet'
  if (l.includes('haiku'))  return 'haiku'
  if (l.includes('opus'))   return 'opus'
  return undefined
}

// ─── Card: Modelos esta semana ─────────────────────────────────────────────────

export function ModelCard({ quota, weeklyModels }: { quota: QuotaData; weeklyModels?: { key: string; label: string; tokens: number; cost: number }[] }) {
  const totalTok  = weeklyModels?.reduce((s, r) => s + r.tokens, 0) ?? 0
  const totalCost = weeklyModels?.reduce((s, r) => s + r.cost, 0) ?? 0

  if (!weeklyModels || weeklyModels.length === 0) {
    return (
      <Card>
        <CardHeader icon={BarChart2} title="Models this week" />
        <span style={{ fontSize: 12, color: '#484f58' }}>No activity this week</span>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader icon={BarChart2} title="Models this week" />
      {weeklyModels.map(r => {
        const ccKey = ccModelKey(r.key)
        const quotaHours = ccKey === 'sonnet' ? quota.weeklyHoursSonnet
          : ccKey === 'haiku' ? quota.weeklyHoursHaiku
          : ccKey === 'opus' ? quota.weeklyHoursOpus
          : undefined
        const quotaLimit = ccKey === 'sonnet' ? quota.weeklyLimitSonnet
          : ccKey === 'opus' ? quota.weeklyLimitOpus
          : 0
        const pct = quotaLimit && quotaHours ? Math.min(100, (quotaHours / quotaLimit) * 100) : 0
        const tokPct = totalTok > 0 ? Math.round((r.tokens / totalTok) * 100) : 0
        return (
          <div key={r.key} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Tip position="bottom" align="left" content={
                <div>
                  <div style={{ color: modelColor(r.key), fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{shortModel(r.key)}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                    {ccKey ? `Claude Code model · Estimated price: ~$${PRICE_PER_M[ccKey as keyof typeof PRICE_PER_M]}/M tokens` : 'OpenCode model'}
                    <br />
                    Tokens = input + output {ccKey ? ' · Hours = 5 min active windows' : ''}
                    {quotaLimit ? ` · Max weekly limit: ${quotaLimit}h` : ''}
                  </div>
                </div>
              }><span style={{ fontSize: 11, color: modelColor(r.key), fontWeight: 700, flexShrink: 0, cursor: 'help' }}>{r.label}</span></Tip>
              {quotaHours !== undefined ? (
                <span style={{ fontSize: 13, color: '#e6edf3', fontWeight: 600 }}>{quotaHours > 0 ? `${quotaHours}h` : '—'}</span>
              ) : null}
              {quotaLimit ? <span style={{ fontSize: 10, color: '#484f58' }}>/ {quotaLimit}h</span> : null}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(r.tokens)}</span>
              <span style={{ fontSize: 10, color: '#3d444d' }}>·</span>
              <span style={{ fontSize: 10, color: '#484f58' }}>{tokPct}%</span>
              <span style={{ fontSize: 10, color: '#3fb950', marginLeft: 4 }}>~{fmtUsd(r.cost)}</span>
            </div>
            {quotaLimit && quotaHours ? (
              <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : modelColor(r.key), borderRadius: 2 }} />
              </div>
            ) : (
              <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${tokPct}%`, height: '100%', background: modelColor(r.key) + 'aa', borderRadius: 2 }} />
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
        Tokens = input + output · Hours = 5 min active windows (Claude Code only) · Estimated blended price
      </div>
    </Card>
  )
}