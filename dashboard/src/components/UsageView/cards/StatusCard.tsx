import { Activity, BrainCircuit, Cpu, Flame, Info } from 'lucide-react'
import type { QuotaData, CostInfo } from '../../../types'
import { Tip } from '../../Tip'
import { fmtTok, fmtUsd } from '../utils'

// ─── Shared helpers (used by multiple cards) ──────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
      padding: '14px 16px', ...style,
    }}>
      {children}
    </div>
  )
}

export function CardHeader({ icon: Icon, title, subtitle, color = '#58a6ff' }: {
  icon: React.ElementType; title: string; subtitle?: string; color?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <Icon size={13} color={color} />
      <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>{title}</span>
      {subtitle && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 2 }}>{subtitle}</span>}
    </div>
  )
}

export function InfoTip({ content, position = 'bottom', align = 'left', style }: {
  content:   React.ReactNode
  position?: 'top' | 'bottom'
  align?:    'left' | 'right'
  style?:    React.CSSProperties
}) {
  return (
    <Tip position={position} align={align} content={content}>
      <Info size={9} color="#3d444d" style={{ cursor: 'help', ...style }} />
    </Tip>
  )
}

// ─── Card: Estado actual (contexto + cuota + reset) ────────────────────────────

export function StatusCard({ quota, cost }: { quota: QuotaData; cost?: CostInfo }) {
  // Contexto
  const ctxUsed       = cost?.context_used ?? 0
  const ctxWindow     = cost?.context_window ?? 200_000
  const compactWindow = Math.round(ctxWindow * 0.85)
  const ctxPct   = ctxUsed > 0 && compactWindow > 0 ? Math.min(100, Math.round(ctxUsed / compactWindow * 100)) : null
  const ctxFree  = ctxPct !== null ? 100 - ctxPct : null
  const ctxColor = ctxFree === null ? '#484f58'
    : ctxFree < 20 ? '#f85149' : ctxFree < 40 ? '#d29922' : '#3fb950'

  // Sesión actual
  const sessionCost = cost?.cost_usd ?? 0
  const inputTok    = cost?.input_tokens ?? 0
  const outputTok   = cost?.output_tokens ?? 0
  const cacheRead   = cost?.cache_read ?? 0

  // Modelo + burn rate
  const model    = cost?.model ?? null
  const burnRate = quota.burnRateTokensPerMin ?? 0
  const shortModel = model
    ? model.replace('claude-', '').replace(/-\d{8}$/, '')
    : null

  return (
    <Card style={{ borderColor: '#30363d' }}>
      <CardHeader icon={Activity} title="Current status" subtitle="real-time" color="#58a6ff" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

        {/* Contexto */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <BrainCircuit size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Context</span>
            <InfoTip position="bottom" align="left" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Free context space</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Percentage available before Claude activates auto-compact.<br />
                  Compact occurs at 85% of the window limit (normally 200K tokens).<br />
                  <span style={{ color: '#d29922' }}>Below 20%: consider using /clear.</span>
                </div>
              </div>
            } />
          </div>
          {ctxFree !== null ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, color: ctxColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {ctxFree}%
              </div>
              <div style={{ fontSize: 9, color: ctxColor, opacity: 0.7, lineHeight: 1, marginBottom: 4 }}>free</div>
              <div style={{ fontSize: 9, color: '#484f58', marginBottom: 6 }}>{Math.round(ctxUsed / 1000)}k used · limit {Math.round(compactWindow / 1000)}k</div>
              <div style={{ width: '100%', height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${ctxPct}%`, height: '100%', background: ctxColor, borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 9, color: '#3d444d', marginTop: 4 }}>
                {ctxFree < 20 ? '⚠ Consider /clear soon' : ctxFree < 40 ? 'Moderate — ok for now' : 'No context pressure'}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>Waiting for data…</div>
          )}
        </div>

        {/* Current session */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Activity size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current session</span>
            <InfoTip position="bottom" align="left" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Cost of this session</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Accumulated from the first message of the active session.<br />
                  <span style={{ color: '#79c0ff' }}>in</span> = tokens sent to Claude (context + message).<br />
                  <span style={{ color: '#56d364' }}>out</span> = tokens generated by Claude.<br />
                  cache = tokens reused (~10× cheaper than fresh input).
                </div>
              </div>
            } />
          </div>
          {sessionCost > 0 ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#e6edf3', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsd(sessionCost)}
              </div>
              <div style={{ fontSize: 9, color: '#484f58', marginTop: 6, lineHeight: 2 }}>
                <span style={{ color: '#79c0ff' }}>in</span> {fmtTok(inputTok)}
                {cacheRead > 0 && <span style={{ color: '#3d444d' }}> · {fmtTok(cacheRead)} cache</span>}
                <br />
                <span style={{ color: '#56d364' }}>out</span> {fmtTok(outputTok)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>No active session</div>
          )}
        </div>

        {/* Model */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <Cpu size={10} color="#484f58" />
            <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Model</span>
            <InfoTip position="bottom" align="right" content={
              <div>
                <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Active model</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.6 }}>
                  Claude model used in the current session.<br />
                  The <span style={{ color: '#d29922' }}>burn rate</span> indicates tokens consumed per minute in real time — useful for estimating how long the quota will last before the next 5h reset.
                </div>
              </div>
            } />
          </div>
          {shortModel ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', lineHeight: 1.3 }}>
                {shortModel}
              </div>
              <div style={{ fontSize: 9, color: '#3d444d', marginTop: 3, wordBreak: 'break-all' }}>{model}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#484f58' }}>—</div>
          )}
          {burnRate > 0 && (
            <Tip position="top" align="right" content={
              <div>
                <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Current burn rate</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                  Tokens consumed per minute in this session.<br />
                  High burn rate = large context or long responses.<br />
                  More than 6,000 tok/min can drain quota quickly.
                </div>
              </div>
            }>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, cursor: 'help' }}>
                <Flame size={9} color="#d29922" />
                <span style={{ fontSize: 10, color: '#d29922', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {burnRate.toLocaleString()} tok/min
                </span>
              </div>
            </Tip>
          )}
        </div>

      </div>
    </Card>
  )
}
