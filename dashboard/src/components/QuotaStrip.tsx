import type { QuotaData } from '../types'
import { fmtDuration, fmtTok } from './shared'

// Shell CSS (.cs-quota, .cs-q, .cs-meter, ...) is injected once by Sidebar.tsx

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', max5: 'Max 5×', max20: 'Max 20×',
  team: 'Team', enterprise: 'Enterprise',
}

function meterColor(pct: number): string {
  return pct > 85 ? 'var(--crit)' : pct > 65 ? 'var(--warn)' : 'var(--accent)'
}

function weeklyPct(hours: number, limit: number): number | null {
  return limit > 0 ? Math.min(100, Math.round(hours / limit * 100)) : null
}

export function QuotaStrip({ quota }: { quota?: QuotaData }) {
  if (!quota) {
    return (
      <div className="cs-quota">
        <span className="cs-plan">—</span>
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>Sin datos de cuota</span>
      </div>
    )
  }

  // Team/Enterprise have no local token limit (never "over" it) — same for any
  // plan we failed to resolve: showing a % there would be fabricated, not measured.
  const hasCycleLimit = quota.cycleLimitTokens > 0
  const sonnetPct = weeklyPct(quota.weeklyHoursSonnet, quota.weeklyLimitSonnet)
  const opusPct   = weeklyPct(quota.weeklyHoursOpus,   quota.weeklyLimitOpus)
  const resetAt   = quota.cycleResetAt || (Date.now() + quota.cycleResetMs)
  const resetMs   = Math.max(0, resetAt - Date.now())

  // Depletion projection: only meaningful with a real token limit and an active burn rate.
  let depletionNote: string | null = null
  if (hasCycleLimit && quota.burnRateTokensPerMin > 0) {
    const remaining = Math.max(0, quota.cycleLimitTokens - quota.cycleTokens)
    const msToDeplete = (remaining / quota.burnRateTokensPerMin) * 60_000
    if (msToDeplete < resetMs) {
      depletionNote = `⚠ Al ritmo actual agotas el ciclo en ${fmtDuration(msToDeplete)}, ${fmtDuration(resetMs - msToDeplete)} antes del reinicio`
    }
  }

  return (
    <div className="cs-quota" aria-label="Cuota del plan">
      <span className="cs-plan">{PLAN_LABEL[quota.detectedPlan] ?? quota.detectedPlan}</span>

      {hasCycleLimit && (
        <div className="cs-q" style={{ flex: '1.4 1 0', minWidth: 160 }}>
          <div className="cs-q-top">
            <span>Ciclo 5h · reinicia en <b>{fmtDuration(resetMs)}</b></span>
            <b>{quota.cyclePct}%</b>
          </div>
          <div className="cs-meter">
            <i style={{ width: `${quota.cyclePct}%`, background: meterColor(quota.cyclePct) }} />
          </div>
        </div>
      )}

      {sonnetPct !== null && (
        <div className="cs-q">
          <div className="cs-q-top"><span>Semanal Sonnet</span><b>{sonnetPct}%</b></div>
          <div className="cs-meter"><i style={{ width: `${sonnetPct}%`, background: meterColor(sonnetPct) }} /></div>
        </div>
      )}

      {opusPct !== null && (
        <div className="cs-q">
          <div className="cs-q-top"><span>Semanal Opus</span><b>{opusPct}%</b></div>
          <div className="cs-meter"><i style={{ width: `${opusPct}%`, background: meterColor(opusPct) }} /></div>
        </div>
      )}

      <div className="cs-q" style={{ minWidth: 100 }}>
        <div className="cs-q-top">
          <span>Ritmo</span>
          <b>{quota.burnRateTokensPerMin > 0 ? fmtTok(quota.burnRateTokensPerMin) : '—'}</b>
        </div>
        <div className="cs-q-top" style={{ color: 'var(--faint)' }}>tokens/min</div>
      </div>

      {depletionNote && <div className="cs-q-note" role="status">{depletionNote}</div>}
    </div>
  )
}
