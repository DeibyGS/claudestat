import { useState, useMemo } from 'react'
import {
  BrainCircuit, Flame, ArrowDownLeft, TriangleAlert,
  Info, CircleX, ChevronsUpDown, ChevronsDownUp,
  type LucideIcon,
} from 'lucide-react'
import type { CostInfo, MetaStats, MetaAlert, QuotaData, SessionState, QuotaStats } from '../../types'
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

export function SidebarKPI({ cost, quota, sessionState = 'idle', meta, quotaStats, startedAt, promptCount = 0 }: {
  cost?:         CostInfo
  quota?:        QuotaData
  sessionState?: SessionState
  meta?:         MetaStats
  quotaStats?:   QuotaStats
  startedAt?:    number
  promptCount?:  number
}) {
  const sm = STATE_META[sessionState]

  const COMPACT_THRESHOLD = 0.85  // keep in sync with KPIBar.tsx
  const compactWindow = cost?.context_window ? Math.round(cost.context_window * COMPACT_THRESHOLD) : null
  const contextPct = cost?.context_used && compactWindow
    ? Math.min(100, Math.round(cost.context_used / compactWindow * 100)) : null
  const ctxFree    = contextPct !== null ? 100 - contextPct : null
  const ctxColor   = ctxFree === null ? '#484f58'
    : ctxFree < 15 ? '#f85149' : ctxFree < 35 ? '#d29922' : '#3fb950'

  const quotaColor = !quota ? '#484f58'
    : quota.cyclePct > 85 ? '#f85149' : quota.cyclePct > 65 ? '#d29922' : '#58a6ff'

  const alerts: MetaAlert[] = []
  if (meta?.alerts) alerts.push(...meta.alerts)
  if (contextPct !== null && contextPct > 85)
    alerts.push({ level: 'critical', message: `Auto-compact soon — ${ctxFree}% free`, metric: 'context' })
  else if (contextPct !== null && contextPct > 65)
    alerts.push({ level: 'warning', message: `Context at ${contextPct}%`, metric: 'context' })

  const resetMs = quota
    ? (quota.cycleResetAt ? quota.cycleResetAt - Date.now() : quota.cycleResetMs)
    : 0

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
        {quota && quota.burnRateTokensPerMin > 0 && (
          <Tip position="bottom" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#d29922', marginBottom: 4 }}>Burn rate</div>
              <div style={{ color: '#7d8590' }}>Token consumption rate in the current session.</div>
              <div style={{ color: '#484f58', marginTop: 6 }}>
                <div>{quota.burnRateTokensPerMin.toLocaleString()} tokens/min</div>
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
                  : `${quota.burnRateTokensPerMin.toLocaleString()} tok/min`
                }
              </span>
            </div>
          </Tip>
        )}
      </div>

      {/* ── Contexto ── */}
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #161b22' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
          <Tip position="bottom" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: ctxColor, marginBottom: 4 }}>Context window</div>
              <div style={{ color: '#7d8590' }}>% calculated over auto-compact threshold (~85% of total window)</div>
              <div style={{ color: '#7d8590', marginTop: 4 }}>Same as "X% until auto-compact" in Claude Code CLI</div>
              <div style={{ color: '#484f58', marginTop: 6, fontSize: 10 }}>
                Total: <span style={{ color: '#e6edf3' }}>{fmtTok(cost?.context_window ?? 200_000)}</span>
                {'  ·  '}Threshold: <span style={{ color: '#e6edf3' }}>{fmtTok(compactWindow ?? 170_000)}</span>
              </div>
            </div>
          }>
            <span style={{ fontSize: 10, color: '#6e7681', cursor: 'default', display: 'flex', alignItems: 'center', gap: 4 }}>
              <BrainCircuit size={10} color="#484f58" />
              Context
            </span>
          </Tip>
          <span style={{ fontSize: 13, fontWeight: 700, color: ctxColor, fontVariantNumeric: 'tabular-nums' }}>
            {ctxFree !== null ? `${ctxFree}% free` : '—'}
          </span>
        </div>
        <div style={{ height: 5, background: '#161b22', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
          {contextPct !== null && (
            <div style={{
              width: `${contextPct}%`, height: '100%', background: ctxColor,
              borderRadius: 3, transition: 'width 0.5s',
              boxShadow: ctxFree !== null && ctxFree < 20 ? `0 0 6px ${ctxColor}88` : undefined,
              animation: ctxFree !== null && ctxFree < 20 ? 'ctxPulse 1.2s ease-in-out infinite' : undefined,
            }} />
          )}
        </div>
        {cost?.context_used && (
          <div style={{ fontSize: 9, color: '#484f58', display: 'flex', gap: 6 }}>
            <span>{fmtTok(cost.context_used)} usados</span>
            <span style={{ color: '#3d444d' }}>·</span>
            <span>compact @{fmtTok(compactWindow ?? 170_000)}</span>
          </div>
        )}
        {ctxFree !== null && ctxFree < CTX_CRITICAL_FREE && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '3px 6px', background: `${EFFICIENCY_ALERT_COLOR}15`, border: `1px solid ${EFFICIENCY_ALERT_COLOR}35`, borderRadius: 4 }}>
            <TriangleAlert size={9} color={EFFICIENCY_ALERT_COLOR} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: EFFICIENCY_ALERT_COLOR, fontWeight: 600 }}>
              Auto-compact inminente — solo {ctxFree}% libre
            </span>
          </div>
        )}
      </div>

      {/* ── Mensajes ── */}
      {promptCount > 0 && (
        <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #161b22' }}>
          {(() => {
            const MSG_SOFT_LIMIT = 20
            const msgPct  = Math.min(100, Math.round(promptCount / MSG_SOFT_LIMIT * 100))
            const msgColor = promptCount < 15 ? '#3fb950' : promptCount < 20 ? '#d29922' : '#f85149'
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Tip position="bottom" align="left" content={
                    <div style={{ fontSize: 11, lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, color: msgColor, marginBottom: 4 }}>Session messages</div>
                      <div style={{ color: '#7d8590' }}>Number of user turns in this session.</div>
                      <div style={{ color: '#484f58', marginTop: 6 }}>
                        <div>Reference: &lt;15 normal · 15-20 heavy · &gt;20 very long session</div>
                      </div>
                    </div>
                  }>
                    <span style={{ fontSize: 10, color: '#6e7681', cursor: 'default', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ArrowDownLeft size={10} color="#484f58" />
                      Messages
                    </span>
                  </Tip>
                  <span style={{ fontSize: 13, fontWeight: 700, color: msgColor, fontVariantNumeric: 'tabular-nums' }}>
                    {promptCount}
                  </span>
                </div>
                <div style={{ height: 5, background: '#161b22', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${msgPct}%`, height: '100%', background: msgColor,
                    borderRadius: 3, transition: 'width 0.5s',
                    boxShadow: promptCount >= 20 ? `0 0 6px ${msgColor}88` : undefined,
                  }} />
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── Modelos semana ── */}
      {quota && (quota.weeklyHoursSonnet > 0 || quota.weeklyHoursOpus > 0) && (
        <div style={{ padding: '7px 12px 7px' }}>
          <Tip position="bottom" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>Weekly usage by model</div>
              <div style={{ color: '#7d8590' }}>Accumulated activity hours by model this week.</div>
              <div style={{ color: '#484f58', marginTop: 6 }}>Limit based on your Claude plan ({PLAN_LABEL[quota.detectedPlan] ?? quota.detectedPlan})</div>
            </div>
          }>
            <div style={{ fontSize: 10, color: '#484f58', marginBottom: 5, cursor: 'default' }}>This week</div>
          </Tip>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ModelBarMini label="Sonnet" color="#58a6ff" hours={quota.weeklyHoursSonnet} limit={quota.weeklyLimitSonnet} />
            {quota.weeklyLimitOpus > 0 && (
              <ModelBarMini label="Opus" color="#d29922" hours={quota.weeklyHoursOpus} limit={quota.weeklyLimitOpus} />
            )}
            {(quota.weeklyHoursHaiku ?? 0) > 0 && (
              <ModelBarMini label="Haiku" color="#3fb950" hours={quota.weeklyHoursHaiku!} limit={0} />
            )}
          </div>
        </div>
      )}

      {/* ── P90 reference ── */}
      {quotaStats && quotaStats.sessionCount >= 5 && (
        <div style={{ padding: '6px 12px 4px', borderTop: '1px solid #161b22' }}>
          <Tip position="bottom" align="left" content={
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>Percentil 90 (P90)</div>
              <div style={{ color: '#7d8590' }}>90% of your sessions consume fewer tokens and cost than this value.</div>
              <div style={{ color: '#484f58', marginTop: 6 }}>Calculated based on {quotaStats.sessionCount} historical sessions.</div>
            </div>
          }>
            <div style={{ fontSize: 9, color: '#484f58', marginBottom: 3, cursor: 'default' }}>Your typical usage (P90)</div>
          </Tip>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(quotaStats.p90Tokens ?? 0)} tokens</span>
            <span style={{ color: '#3d444d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: '#6e7681' }}>~${(quotaStats.p90Cost ?? 0).toFixed(2)}</span>
            <span style={{ color: '#3d444d', fontSize: 10 }}>·</span>
            <span style={{ fontSize: 9, color: '#3d444d' }}>{quotaStats.sessionCount} sessions</span>
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
