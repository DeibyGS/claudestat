import { BarChart2, Shield, AlertTriangle, TrendingUp, Lightbulb, CheckCircle2, TriangleAlert, Info, XCircle } from 'lucide-react'
import type { QuotaData, CostInfo, TraceEvent } from '../types'

// ─── Precios por millón de tokens ─────────────────────────────────────────────
const PRICE_PER_M = {
  sonnet: 6.6,   // blended ~70% input / 30% output
  haiku:  1.76,
  opus:   33.0,
}
const CACHE_SAVINGS_PER_M = 2.70  // Sonnet: full $3/M → cached $0.30/M → ahorro $2.70/M

interface Props {
  quota?:   QuotaData
  cost?:    CostInfo
  events?:  TraceEvent[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}
function fmtUsd(n: number): string {
  if (n === 0)    return '$0.00'
  if (n < 0.001)  return '<$0.001'
  if (n < 0.01)   return `$${n.toFixed(4)}`
  if (n < 1)      return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

// ─── Coach: generador de tips ──────────────────────────────────────────────────

type TipLevel = 'error' | 'warning' | 'info' | 'success'
interface CoachTip { level: TipLevel; title: string; text: string }

function generateTips(cost?: CostInfo, quota?: QuotaData, events?: TraceEvent[]): CoachTip[] {
  const tips: CoachTip[] = []

  // 1. Loops activos
  if (cost?.loops && cost.loops.length > 0) {
    for (const l of cost.loops) {
      tips.push({
        level: 'error',
        title: `Loop: ${l.toolName} ×${l.count}`,
        text: `La misma herramienta se ejecutó ${l.count} veces seguidas. Comprueba si el resultado anterior fue ignorado o si el prompt está siendo ambiguo.`,
      })
    }
  }

  // 2. Re-lecturas (mismo archivo ≥3 veces)
  if (events && events.length > 0) {
    const readCounts = new Map<string, number>()
    for (const e of events) {
      if (e.tool_name === 'Read' && e.type === 'Done' && e.tool_input) {
        try {
          const fp: string = JSON.parse(e.tool_input).file_path || ''
          if (fp) readCounts.set(fp, (readCounts.get(fp) || 0) + 1)
        } catch {}
      }
    }
    const reReads = [...readCounts.entries()].filter(([, c]) => c >= 3)
    if (reReads.length > 0) {
      const names = reReads.map(([f]) => f.split('/').pop()).join(', ')
      tips.push({
        level: 'warning',
        title: `Re-lecturas (${reReads.length} archivo${reReads.length > 1 ? 's' : ''})`,
        text: `${names} ${reReads.length > 1 ? 'fueron leídos' : 'fue leído'} 3+ veces. Usa offset+limit para leer solo lo necesario, o Grep para buscar sin leer el archivo completo.`,
      })
    }
  }

  // 3. Cache hit baja
  if (cost) {
    const total = cost.input_tokens + cost.cache_read + cost.cache_creation
    const hitRate = total > 5000 ? cost.cache_read / total : -1
    if (hitRate >= 0 && hitRate < 0.30) {
      tips.push({
        level: 'warning',
        title: `Cache hit bajo: ${Math.round(hitRate * 100)}%`,
        text: 'Claude cachea el contexto automáticamente en sesiones largas. Evita borrar el historial manualmente y trabaja en sesiones continuas para acumular caché.',
      })
    }
  }

  // 4. Eficiencia baja
  if (cost && cost.efficiency_score > 0 && cost.efficiency_score < 70) {
    tips.push({
      level: 'warning',
      title: `Eficiencia baja: ${cost.efficiency_score}/100`,
      text: 'Los loops y relecturas están consumiendo tokens innecesariamente. Revisa si Claude está repitiendo pasos o si las instrucciones son ambiguas.',
    })
  }

  // 5. Burn rate alto
  if (quota && quota.burnRateTokensPerMin > 6000) {
    tips.push({
      level: 'info',
      title: `Burn rate alto: ${quota.burnRateTokensPerMin.toLocaleString()} tok/min`,
      text: 'Estás consumiendo tokens muy rápido. Considera pedir respuestas más concisas, evitar adjuntar archivos grandes completos, o dividir la tarea en pasos.',
    })
  }

  // 6. Bash overuse
  if (events && events.length > 0) {
    const done = events.filter(e => e.type === 'Done')
    const bashCount = done.filter(e => e.tool_name === 'Bash').length
    const readCount = done.filter(e => e.tool_name === 'Read').length
    const grepCount = done.filter(e => e.tool_name === 'Grep').length
    if (bashCount > 6 && grepCount === 0 && readCount > 4) {
      tips.push({
        level: 'info',
        title: `Bash+Read sin Grep (${bashCount} Bash, ${readCount} Read)`,
        text: 'Estás combinando Bash y Read para buscar información. Grep es más eficiente para buscar dentro de archivos — usa Grep antes de Read cuando no sabes en qué línea está algo.',
      })
    }
  }

  // 7. Cuota alta
  if (quota && quota.cyclePct > 70) {
    tips.push({
      level: quota.cyclePct > 85 ? 'error' : 'warning',
      title: `Cuota al ${quota.cyclePct}%`,
      text: `Usaste ${quota.cyclePrompts}/${quota.cycleLimit} prompts en la ventana de 5h. Agrupa varios cambios en un solo mensaje en vez de enviar uno por uno.`,
    })
  }

  // 8. Buenas prácticas
  if (cost && cost.cache_read > 30_000) {
    const savings = (cost.cache_read / 1_000_000) * CACHE_SAVINGS_PER_M
    if (savings > 0.02) {
      tips.push({
        level: 'success',
        title: `Caché óptima — ahorrando ${fmtUsd(savings)}`,
        text: 'Estás aprovechando bien la caché de prompts. Las sesiones largas y continuas maximizan el ahorro.',
      })
    }
  }
  if (cost && cost.efficiency_score >= 90) {
    tips.push({
      level: 'success',
      title: `Eficiencia excelente: ${cost.efficiency_score}/100`,
      text: 'Sin loops detectados en esta sesión. Buen ritmo de trabajo.',
    })
  }

  return tips
}

// ─── Componentes de sección ────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
      padding: '14px 16px', ...style,
    }}>
      {children}
    </div>
  )
}

function CardHeader({ icon: Icon, title, subtitle, color = '#58a6ff' }: {
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

// ─── Card: Modelos esta semana ─────────────────────────────────────────────────

function ModelCard({ quota }: { quota: QuotaData }) {
  const rows = [
    { label: 'Sonnet', color: '#58a6ff', hours: quota.weeklyHoursSonnet, limit: quota.weeklyLimitSonnet, tokens: quota.weeklyTokensSonnet ?? 0, price: PRICE_PER_M.sonnet },
    { label: 'Haiku',  color: '#3fb950', hours: quota.weeklyHoursHaiku,  limit: 0,                       tokens: quota.weeklyTokensHaiku  ?? 0, price: PRICE_PER_M.haiku  },
    { label: 'Opus',   color: '#d29922', hours: quota.weeklyHoursOpus,   limit: quota.weeklyLimitOpus,   tokens: quota.weeklyTokensOpus   ?? 0, price: PRICE_PER_M.opus   },
  ].filter(r => r.hours > 0 || r.tokens > 0)

  const totalCost = rows.reduce((s, r) => s + (r.tokens / 1_000_000) * r.price, 0)
  const totalTok  = rows.reduce((s, r) => s + r.tokens, 0)

  return (
    <Card>
      <CardHeader icon={BarChart2} title="Modelos esta semana" />
      {rows.length === 0 ? (
        <span style={{ fontSize: 12, color: '#484f58' }}>Sin actividad esta semana</span>
      ) : (
        <>
          {rows.map(r => {
            const pct     = r.limit > 0 ? Math.min(100, (r.hours / r.limit) * 100) : 0
            const estCost = (r.tokens / 1_000_000) * r.price
            const tokPct  = totalTok > 0 ? Math.round((r.tokens / totalTok) * 100) : 0
            return (
              <div key={r.label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 46, fontSize: 11, color: r.color, fontWeight: 700, flexShrink: 0 }}>{r.label}</span>
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
              <div style={{ fontSize: 9, color: '#484f58' }}>total semana</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#3fb950' }}>~{fmtUsd(totalCost)}</div>
              <div style={{ fontSize: 9, color: '#484f58' }}>costo estimado</div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: '#3d444d', marginTop: 6 }}>
            Horas = ventanas de 5 min activas · Tokens = input + output · Precio estimado blended
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Card: Cache ───────────────────────────────────────────────────────────────

function CacheCard({ cost }: { cost: CostInfo }) {
  const { input_tokens, cache_read, cache_creation, output_tokens } = cost
  const total   = input_tokens + cache_read + cache_creation + output_tokens
  const hitRate = total > 0 ? Math.round((cache_read / (input_tokens + cache_read + cache_creation)) * 100) : 0
  const savings = (cache_read / 1_000_000) * CACHE_SAVINGS_PER_M
  const color   = hitRate >= 70 ? '#3fb950' : hitRate >= 40 ? '#d29922' : '#f85149'

  const bars = [
    { label: 'cache hit',    color: '#3fb95099', tokens: cache_read,    pct: total > 0 ? cache_read / total * 100 : 0 },
    { label: 'cache create', color: '#58a6ff55', tokens: cache_creation, pct: total > 0 ? cache_creation / total * 100 : 0 },
    { label: 'input fresco', color: '#8b949e55', tokens: input_tokens,  pct: total > 0 ? input_tokens / total * 100 : 0 },
    { label: 'output',       color: '#d2992255', tokens: output_tokens, pct: total > 0 ? output_tokens / total * 100 : 0 },
  ].filter(b => b.tokens > 0)

  return (
    <Card>
      <CardHeader icon={Shield} title="Eficiencia de caché" subtitle="sesión actual" color={color} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {hitRate}%
        </span>
        <div>
          <div style={{ fontSize: 11, color: '#e6edf3' }}>cache hit rate</div>
          {savings > 0.001 && (
            <div style={{ fontSize: 10, color: '#3fb950' }}>~{fmtUsd(savings)} ahorrados</div>
          )}
          <div style={{ fontSize: 9, color: '#484f58' }}>objetivo ≥70%</div>
        </div>
      </div>
      <div style={{ height: 8, background: '#21262d', borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 10 }}>
        {bars.map(b => (
          <div key={b.label} style={{ width: `${b.pct}%`, height: '100%', background: b.color }} title={`${b.label}: ${fmtTok(b.tokens)}`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {bars.map(b => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtTok(b.tokens)}</span>
            <span style={{ fontSize: 10, color: '#484f58' }}>{b.label}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Card: Loops ───────────────────────────────────────────────────────────────

function LoopsCard({ cost }: { cost: CostInfo }) {
  const { loops, efficiency_score } = cost
  const totalLoops  = loops?.reduce((s, l) => s + l.count, 0) ?? 0
  const wastedUsd   = (totalLoops * 1_200 / 1_000_000) * PRICE_PER_M.sonnet
  const scoreColor  = efficiency_score >= 90 ? '#3fb950' : efficiency_score >= 70 ? '#d29922' : '#f85149'

  return (
    <Card>
      <CardHeader icon={AlertTriangle} title="Loops y eficiencia" subtitle="sesión actual" color={totalLoops > 0 ? '#f85149' : '#3fb950'} />
      <div style={{ display: 'flex', gap: 16, marginBottom: totalLoops > 0 ? 10 : 0 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: totalLoops > 0 ? '#f85149' : '#3fb950', lineHeight: 1 }}>
            {totalLoops}
          </div>
          <div style={{ fontSize: 9, color: '#484f58' }}>loops detectados</div>
        </div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
            {efficiency_score}
          </div>
          <div style={{ fontSize: 9, color: '#484f58' }}>eficiencia /100</div>
        </div>
        {totalLoops > 0 && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#d29922', lineHeight: 1 }}>
              ~{fmtUsd(wastedUsd)}
            </div>
            <div style={{ fontSize: 9, color: '#484f58' }}>tokens desperdiciados</div>
          </div>
        )}
      </div>
      {totalLoops > 0 && loops && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {loops.map((l, i) => (
            <span key={i} style={{ fontSize: 11, color: '#f85149', background: '#f8514914', border: '1px solid #f8514930', borderRadius: 4, padding: '2px 7px' }}>
              {l.toolName} ×{l.count}
            </span>
          ))}
        </div>
      )}
      <div style={{ height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${efficiency_score}%`, height: '100%', background: scoreColor, borderRadius: 2, transition: 'width 0.5s' }} />
      </div>
    </Card>
  )
}

// ─── Card: Proyección mensual ──────────────────────────────────────────────────

function ProjectionCard({ quota, cost }: { quota: QuotaData; cost?: CostInfo }) {
  const weeklyTokens    = (quota.weeklyTokensSonnet ?? 0) + (quota.weeklyTokensOpus ?? 0) + (quota.weeklyTokensHaiku ?? 0)
  const weeklyCost      = ((quota.weeklyTokensSonnet ?? 0) / 1_000_000) * PRICE_PER_M.sonnet
    + ((quota.weeklyTokensOpus   ?? 0) / 1_000_000) * PRICE_PER_M.opus
    + ((quota.weeklyTokensHaiku  ?? 0) / 1_000_000) * PRICE_PER_M.haiku
  const monthlyCost     = weeklyCost * 4.3
  const burnUsdPerHour  = quota.burnRateTokensPerMin > 0
    ? ((quota.burnRateTokensPerMin * 60) / 1_000_000) * PRICE_PER_M.sonnet
    : 0
  const dailyCost = weeklyCost / 7

  return (
    <Card>
      <CardHeader icon={TrendingUp} title="Proyección mensual" subtitle="basado en esta semana" />
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#e6edf3', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {weeklyCost > 0 ? `~${fmtUsd(monthlyCost)}` : '—'}
          </div>
          <div style={{ fontSize: 9, color: '#484f58' }}>/mes · {weeklyCost > 0 ? `${fmtUsd(weeklyCost)}/sem · ${fmtUsd(dailyCost)}/día` : 'sin datos'}</div>
        </div>
        {burnUsdPerHour > 0 && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#d29922', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              ~{fmtUsd(burnUsdPerHour)}/h
            </div>
            <div style={{ fontSize: 9, color: '#484f58' }}>ahora · {quota.burnRateTokensPerMin.toLocaleString()} tok/min</div>
          </div>
        )}
      </div>
      {weeklyTokens > 0 && (
        <div style={{ fontSize: 10, color: '#484f58' }}>
          {fmtTok(weeklyTokens)} tokens esta semana · precios estimados blended input/output
        </div>
      )}
    </Card>
  )
}

// ─── Panel: Coach en tiempo real ───────────────────────────────────────────────

const TIP_STYLE: Record<TipLevel, { color: string; bg: string; border: string; Icon: React.ElementType }> = {
  error:   { color: '#f85149', bg: '#3d1717', border: '#f8514940', Icon: XCircle },
  warning: { color: '#d29922', bg: '#2d2008', border: '#d2992240', Icon: TriangleAlert },
  info:    { color: '#58a6ff', bg: '#0d1e33', border: '#58a6ff30', Icon: Info },
  success: { color: '#3fb950', bg: '#0d1f10', border: '#3fb95030', Icon: CheckCircle2 },
}

function CoachPanel({ tips }: { tips: CoachTip[] }) {
  if (tips.length === 0) {
    return (
      <Card>
        <CardHeader icon={Lightbulb} title="Optimizador en tiempo real" color="#d29922" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', fontSize: 12 }}>
          <CheckCircle2 size={14} color="#3fb950" />
          Sesión limpia — sin sugerencias de optimización por ahora
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader icon={Lightbulb} title="Optimizador en tiempo real" subtitle={`${tips.length} sugerencia${tips.length > 1 ? 's' : ''}`} color="#d29922" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tips.map((tip, i) => {
          const s = TIP_STYLE[tip.level]
          return (
            <div key={i} style={{
              background: s.bg, border: `1px solid ${s.border}`,
              borderLeft: `3px solid ${s.color}`,
              borderRadius: 6, padding: '8px 10px',
              display: 'flex', gap: 8,
            }}>
              <s.Icon size={13} color={s.color} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 2 }}>{tip.title}</div>
                <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>{tip.text}</div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function UsageView({ quota, cost, events }: Props) {
  if (!quota) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 13 }}>
        Cargando datos de uso…
      </div>
    )
  }

  const tips = generateTips(cost, quota, events)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '16px 20px' }}>

      {/* Grid 2 columnas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto',
        gap: 12,
        maxWidth: 1200,
        margin: '0 auto',
      }}>

        {/* Fila 1: Coach (full width) */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CoachPanel tips={tips} />
        </div>

        {/* Fila 2: Modelos | Cache */}
        <ModelCard quota={quota} />
        {cost ? <CacheCard cost={cost} /> : (
          <Card>
            <CardHeader icon={Shield} title="Eficiencia de caché" />
            <span style={{ fontSize: 12, color: '#484f58' }}>Sin datos de sesión activa</span>
          </Card>
        )}

        {/* Fila 3: Proyección | Loops */}
        <ProjectionCard quota={quota} cost={cost} />
        {cost ? <LoopsCard cost={cost} /> : (
          <Card>
            <CardHeader icon={AlertTriangle} title="Loops y eficiencia" />
            <span style={{ fontSize: 12, color: '#484f58' }}>Sin datos de sesión activa</span>
          </Card>
        )}

      </div>
    </div>
  )
}
