import { useState, useMemo } from 'react'
import {
  BrainCircuit, Flame, ArrowDownLeft, TriangleAlert,
  Info, CircleX, ChevronsUpDown, ChevronsDownUp,
  type LucideIcon,
} from 'lucide-react'
import type { CostInfo, MetaStats, MetaAlert, QuotaData, SessionState } from '../../types'

export interface OcModelUsage {
  model:    string
  sessions: number
  totalCost: number
}
import { Tip } from '../Tip'
import {
  fmtUsd, fmtTok, fmtResetMs,
  estimateCacheSavings,
  EFFICIENCY_CTX_WARN, TOOL_CALL_WARN, EFFICIENCY_ALERT_COLOR, CTX_CRITICAL_FREE,
} from './utils'
import type { SessionPromptItem } from './utils'
import type { TraceEvent } from '../../types'
import { useEffect, useRef } from 'react'

// ─── State metadata ───────────────────────────────────────────────────────────

const STATE_META: Record<SessionState, { label: string; color: string; pulse: boolean }> = {
  working:           { label: 'working', color: '#3fb950', pulse: true  },
  waiting_for_input: { label: 'waiting', color: '#58a6ff', pulse: false },
  idle:              { label: 'idle',    color: '#7d8590', pulse: false },
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', max5: 'Max 5×', max20: 'Max 20×',
}

const ALERT_ICON: Record<string, LucideIcon> = {
  info: Info, warning: TriangleAlert, critical: CircleX,
}

// ─── ModelBarMini ─────────────────────────────────────────────────────────────

function ModelBarMini({ label, color, hours, limit }: { label: string; color: string; hours: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round(hours / limit * 100)) : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color, fontSize: 9, fontWeight: 700, width: 40, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        {pct !== null && (
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2,
            background: pct > 85 ? '#f85149' : pct > 65 ? '#d29922' : color }} />
        )}
      </div>
      <span style={{ color: '#6e7681', fontSize: 9, width: 22, textAlign: 'right', flexShrink: 0 }}>
        {hours > 0 ? `${hours}h` : '—'}
      </span>
    </div>
  )
}

// ─── AnimatedCost ─────────────────────────────────────────────────────────────

/** Contador animado de costo — interpola del valor anterior al nuevo en 600ms */
export function AnimatedCost({ usd }: { usd: number }) {
  const [displayed, setDisplayed] = useState(usd)
  const prev = useRef(usd)
  const raf  = useRef<number>(0)

  useEffect(() => {
    const from  = prev.current
    const to    = usd
    if (Math.abs(to - from) < 0.00005) { setDisplayed(to); return }
    const start = performance.now()
    const dur   = 600
    const tick  = (now: number) => {
      const t = Math.min((now - start) / dur, 1)
      const ease = 1 - Math.pow(1 - t, 3)  // ease-out-cubic
      setDisplayed(from + (to - from) * ease)
      if (t < 1) raf.current = requestAnimationFrame(tick)
      else prev.current = to
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [usd])

  return <>{fmtUsd(displayed)}</>
}

// ─── deriveEfficiencyReasons ──────────────────────────────────────────────────

// Devuelve bullets explicando por qué la eficiencia es baja.
// Cada razón es accionable: describe el síntoma + su impacto en tokens/costo.
export function deriveEfficiencyReasons(
  cost: CostInfo,
  events: TraceEvent[],
  prompts: SessionPromptItem[],
): string[] {
  const reasons: string[] = []
  const toolCallCount = events.filter(e => e.type === 'Done').length

  if (cost.loops.length > 0) {
    const top     = cost.loops.slice(0, 2).map(l => `${l.toolName} ×${l.count}`).join(', ')
    const extra   = cost.loops.length > 2 ? ` +${cost.loops.length - 2} more` : ''
    reasons.push(`Detected loops: ${top}${extra} — Claude repeated the same calls without progressing`)
  }

  if (toolCallCount > TOOL_CALL_WARN) {
    reasons.push(`${toolCallCount} tools executed — long sessions accumulate previous context and raise cost per turn`)
  }

  const ctxPct = cost.context_used && cost.context_window
    ? cost.context_used / cost.context_window : 0
  if (ctxPct > EFFICIENCY_CTX_WARN) {
    reasons.push(`Context at ${Math.round(ctxPct * 100)}% — Claude reads more history in each response, increasing input tokens`)
  }

  if (prompts.length > 0) {
    const avgLen = prompts.reduce((s, p) => s + p.text.length, 0) / prompts.length
    if (avgLen > 600) {
      reasons.push(`Long prompts (~${Math.round(avgLen)} avg chars) — detailed messages increase input context`)
    }
  }

  if (cost.cost_usd > 10) {
    reasons.push(`High cost ($${cost.cost_usd.toFixed(2)}) — sign of intensive session; check for unnecessary iterations`)
  }

  return reasons
}

// ─── EfficiencyAlert ──────────────────────────────────────────────────────────

export function EfficiencyAlert({ cost, events, prompts }: {
  cost:    CostInfo
  events:  TraceEvent[]
  prompts: SessionPromptItem[]
}) {
  const [open, setOpen] = useState(false)
  const reasons = useMemo(
    () => deriveEfficiencyReasons(cost, events, prompts),
    [cost, events, prompts],
  )
  if (reasons.length === 0) return null
  const c = EFFICIENCY_ALERT_COLOR
  return (
    <div style={{ background: `${c}10`, border: `1px solid ${c}30`, borderLeft: `2px solid ${c}`, borderRadius: 5, padding: '5px 8px' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <TriangleAlert size={9} color={c} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: c, fontWeight: 600, flex: 1, textAlign: 'left' }}>Low efficiency — {reasons.length} cause{reasons.length > 1 ? 's' : ''}</span>
        {open ? <ChevronsDownUp size={9} color={c} /> : <ChevronsUpDown size={9} color={c} />}
      </button>
      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {reasons.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
              <span style={{ color: c, fontSize: 10, flexShrink: 0, marginTop: 1 }}>·</span>
              <span style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.5 }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SidebarKPI ───────────────────────────────────────────────────────────────

export function SidebarKPI({ cost, quota, sessionState = 'idle', meta, ocModelUsage, startedAt, burnRateTokensPerMin }: {
  cost?:                  CostInfo
  quota?:                 QuotaData
  sessionState?:          SessionState
  meta?:                  MetaStats
  ocModelUsage?:          OcModelUsage[]
  startedAt?:             number
  burnRateTokensPerMin?:  number
}) {
  const sm = STATE_META[sessionState]

  const COMPACT_THRESHOLD = 0.85
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100)) : null
  const ctxFree    = contextPct !== null ? 100 - contextPct : null
  const ctxColor   = ctxFree === null ? '#484f58'
    : ctxFree < 15 ? '#f85149' : ctxFree < 35 ? '#d29922' : '#3fb950'

  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  if (contextPct !== null && contextPct > 85)
    alerts.push({ level: 'critical', message: `Auto-compact soon — ${ctxFree}% free`, metric: 'context' })
  else if (contextPct !== null && contextPct > 65)
    alerts.push({ level: 'warning', message: `Context at ${contextPct}%`, metric: 'context' })

  const hasQuotaModels = quota && (quota.weeklyHoursSonnet > 0 || quota.weeklyHoursOpus > 0)
  const hasOcModels = ocModelUsage && ocModelUsage.length > 0

  return (
    <div style={{ borderBottom: '1px solid #21262d', flexShrink: 0, background: '#090d12' }}>

      {/* ── Fila estado + burn rate ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px 6px',
        borderBottom: '1px solid #161b22',
      }}>
        <Tip position="bottom" align="left" content={
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: sm.color, marginBottom: 4 }}>Session state</div>
            <div style={{ color: '#7d8590' }}>
              {sessionState === 'working' && 'Claude is actively executing tools.'}
              {sessionState === 'waiting_for_input' && 'Claude is waiting for your response or confirmation.'}
              {sessionState === 'idle' && 'No activity. Waiting for a new message.'}
            </div>
          </div>
        }>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
            {sm.pulse && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: sm.color,
                display: 'inline-block', boxShadow: `0 0 5px ${sm.color}`,
                animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0,
              }} />
            )}
            <span style={{ color: sm.color, fontSize: 12, fontWeight: 700, letterSpacing: '-0.2px' }}>
              {sm.label}
            </span>
          </div>
        </Tip>
        {(() => {
          const rate = quota?.burnRateTokensPerMin ?? burnRateTokensPerMin ?? 0
          if (rate <= 0) return null
          return (
            <Tip position="bottom" content={
              <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: '#d29922', marginBottom: 4 }}>Burn rate</div>
                <div style={{ color: '#7d8590' }}>
                  {quota ? 'Token consumption rate in the current session.' : 'Average token rate for this session.'}
                </div>
                <div style={{ color: '#484f58', marginTop: 6 }}>
                  <div>{rate.toLocaleString()} tokens/min</div>
                  {cost?.projected_hourly_usd && cost.projected_hourly_usd > 0.001 && cost.projected_hourly_usd < 50 && (
                    <div>Projection: ~{fmtUsd(cost.projected_hourly_usd)}/h at current rate</div>
                  )}
                </div>
              </div>
            }>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
                <Flame size={9} color="#d29922" />
                <span style={{ fontSize: 10, color: '#d29922', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {cost?.projected_hourly_usd
                    && cost.projected_hourly_usd > 0.001
                    && cost.projected_hourly_usd < 50
                    && startedAt
                    && (Date.now() - startedAt) > 2 * 60_000
                    ? `~${fmtUsd(cost.projected_hourly_usd)}/h`
                    : `${rate.toLocaleString()} tok/min`
                  }
                </span>
              </div>
            </Tip>
          )
        })()}
      </div>

      {/* ── Modelos semana (CC o OC) ── */}
      {hasQuotaModels && (
        <div style={{ padding: '7px 12px 7px', borderBottom: '1px solid #161b22' }}>
          <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>This week</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ModelBarMini label="Sonnet" color="#58a6ff" hours={quota!.weeklyHoursSonnet} limit={quota!.weeklyLimitSonnet} />
            {quota!.weeklyLimitOpus > 0 && (
              <ModelBarMini label="Opus" color="#d29922" hours={quota!.weeklyHoursOpus} limit={quota!.weeklyLimitOpus} />
            )}
            {(quota!.weeklyHoursHaiku ?? 0) > 0 && (
              <ModelBarMini label="Haiku" color="#3fb950" hours={quota!.weeklyHoursHaiku!} limit={0} />
            )}
          </div>
        </div>
      )}

      {hasOcModels && !hasQuotaModels && (
        <div style={{ padding: '7px 12px 7px', borderBottom: '1px solid #161b22' }}>
          <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5 }}>Models (7d)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ocModelUsage!.slice(0, 4).map(m => {
              const mc = m.model.includes('opus') ? '#d29922'
                : m.model.includes('haiku') ? '#3fb950'
                : m.model.includes('deepseek') ? '#bc8cff'
                : '#58a6ff'
              const ml = m.model.includes('opus') ? 'Opus'
                : m.model.includes('haiku') ? 'Haiku'
                : m.model.includes('deepseek') ? 'DeepSeek'
                : m.model.includes('mimo') ? 'Mimo'
                : m.model.length > 12 ? m.model.slice(0, 12) + '…' : m.model
              return (
                <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: mc, fontSize: 9, fontWeight: 700, width: 52, flexShrink: 0 }}>{ml}</span>
                  <div style={{ flex: 1, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round(m.sessions / (ocModelUsage![0]?.sessions || 1) * 100))}%`, height: '100%', borderRadius: 2, background: mc }} />
                  </div>
                  <span style={{ color: '#6e7681', fontSize: 9, width: 22, textAlign: 'right', flexShrink: 0 }}>
                    {m.sessions}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Alertas ── */}
      {alerts.length > 0 && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {alerts.slice(0, 2).map((a, i) => {
            const c = ({ info: '#58a6ff', warning: '#d29922', critical: '#f85149' } as const)[a.level]
            const AlertIcon = ALERT_ICON[a.level] ?? Info
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 10, color: c,
                background: c + '15', border: `1px solid ${c}30`,
                borderRadius: 4, padding: '3px 8px',
              }}>
                <AlertIcon size={9} />
                <span>{a.message}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
