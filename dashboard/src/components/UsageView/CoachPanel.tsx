import { CheckCircle2, Info, Lightbulb, TriangleAlert, XCircle } from 'lucide-react'
import type { CoachTip, TipLevel } from './utils'
import { Card, CardHeader } from './cards/StatusCard'

// ─── Panel: Coach en tiempo real ───────────────────────────────────────────────

const TIP_STYLE: Record<TipLevel, { color: string; bg: string; border: string; Icon: React.ElementType }> = {
  error:   { color: '#f85149', bg: '#3d1717', border: '#f8514940', Icon: XCircle },
  warning: { color: '#d29922', bg: '#2d2008', border: '#d2992240', Icon: TriangleAlert },
  info:    { color: '#58a6ff', bg: '#0d1e33', border: '#58a6ff30', Icon: Info },
  success: { color: '#3fb950', bg: '#0d1f10', border: '#3fb95030', Icon: CheckCircle2 },
}

export function CoachPanel({ tips }: { tips: CoachTip[] }) {
  if (tips.length === 0) {
    return (
      <Card>
        <CardHeader icon={Lightbulb} title="Real-time optimizer" color="#d29922" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', fontSize: 12 }}>
          <CheckCircle2 size={14} color="#3fb950" />
          Clean session — no optimization suggestions at this time
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader icon={Lightbulb} title="Real-time optimizer" subtitle={`${tips.length} suggestion${tips.length > 1 ? 's' : ''}`} color="#d29922" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tips.map((tip, i) => {
          const s = TIP_STYLE[tip.level]
          return (
            <div key={i} style={{
              background: s.bg, border: `1px solid ${s.border}`,
              borderLeft: `3px solid ${s.color}`,
              borderRadius: 6, padding: '8px 10px',
            }}>
              {/* Header: icono + título */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <s.Icon size={13} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 3 }}>{tip.title}</div>
                  <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>{tip.text}</div>
                </div>
              </div>

              {/* Prompt that caused it */}
              {tip.prompt && (
                <div style={{
                  marginTop: 8, padding: '6px 10px',
                  background: '#0d1117', border: '1px solid #30363d',
                  borderRadius: 5,
                }}>
                  <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                    Prompt that caused it — Block #{tip.blockIndex}
                  </div>
                  <div style={{
                    fontSize: 11, color: '#7d8590', fontStyle: 'italic',
                    lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 80, overflow: 'hidden',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
                  }}>
                    "{tip.prompt}"
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
