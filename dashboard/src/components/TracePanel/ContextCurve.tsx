import { useState, useRef, useCallback } from 'react'
import type { BlockCost } from '../../types'
import type { Block } from './utils'
import { fmtTok } from './utils'

interface Props {
  blocks:     Block[]
  blockCosts: BlockCost[]
}

const H = 44   // chart height px
const PY = 4   // vertical padding inside chart

export function ContextCurve({ blocks, blockCosts }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const COMPACT_THRESHOLD = 0.85  // match SidebarKPI — % of window before auto-compact
  // Build points: one per block, only blocks with context data
  const points = blocks.map((b, i) => {
    const bc   = blockCosts[b.index - 1]
    const used = bc?.context_used
    const win  = bc?.context_window
    if (!used || !win || win === 0) return null
    const compactWin = Math.round(win * COMPACT_THRESHOLD)
    return { blockIndex: b.index, i, pct: Math.min(100, Math.round(used / compactWin * 100)), used, win }
  })

  const valid = points.filter(Boolean) as NonNullable<typeof points[0]>[]
  if (valid.length < 2) return null

  const lastPct = valid[valid.length - 1].pct
  const lineColor = lastPct >= 80 ? '#f85149' : lastPct >= 50 ? '#d29922' : '#3fb950'

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || valid.length < 2) return
    const relX = e.clientX - rect.left
    const step = rect.width / (valid.length - 1)
    const idx  = Math.min(valid.length - 1, Math.max(0, Math.round(relX / step)))
    setHovered(idx)
  }, [valid.length])

  const W = 100   // viewBox width (percentage-based, SVG scales)

  const xOf = (i: number) => valid.length > 1 ? (i / (valid.length - 1)) * W : W / 2
  const yOf = (pct: number) => PY + (1 - pct / 100) * (H - PY * 2)

  const polyline = valid.map((p, i) => `${xOf(i)},${yOf(p.pct)}`).join(' ')

  const hov = hovered !== null ? valid[hovered] : null

  return (
    <div style={{ borderBottom: '1px solid #21262d', background: '#090d12', padding: '6px 16px 4px', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#484f58', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        <span>Context usage</span>
        <span style={{ color: lineColor, fontVariantNumeric: 'tabular-nums' }}>{lastPct}%</span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: H, display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          {/* 50% and 80% threshold lines */}
          <line x1={0} y1={yOf(80)} x2={W} y2={yOf(80)} stroke="#f8514922" strokeWidth={0.5} strokeDasharray="2,2" />
          <line x1={0} y1={yOf(50)} x2={W} y2={yOf(50)} stroke="#d2992222" strokeWidth={0.5} strokeDasharray="2,2" />

          {/* Fill area under curve */}
          <polygon
            points={`0,${H} ${polyline} ${W},${H}`}
            fill={lineColor + '18'}
          />

          {/* Main line */}
          <polyline
            points={polyline}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Hover dot */}
          {hov !== null && (
            <circle
              cx={xOf(hovered!)}
              cy={yOf(hov.pct)}
              r={2}
              fill={lineColor}
              stroke="#090d12"
              strokeWidth={1}
            />
          )}
        </svg>

        {/* Tooltip */}
        {hov !== null && (() => {
          const xPct = xOf(hovered!) / W * 100
          const onRight = xPct > 55
          return (
            <div style={{
              position: 'absolute',
              top: Math.max(0, yOf(hov.pct) - 6),
              left:  onRight ? undefined : `${xPct}%`,
              right: onRight ? `${100 - xPct}%` : undefined,
              transform: onRight ? 'translateX(8px)' : 'translateX(-8px)',
              background: '#1c2128',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 10,
              color: '#c9d1d9',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, color: lineColor }}>Block #{hov.blockIndex} — {hov.pct}%</div>
              <div style={{ color: '#8b949e' }}>{fmtTok(hov.used)} / {fmtTok(hov.win)} tokens</div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
