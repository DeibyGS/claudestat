import { useState } from 'react'
import type { BlockCost } from '../../types'
import type { Block } from './utils'
import { fmtUsd, fmtTok } from './utils'

export function CostTimeline({
  blocks, blockCosts, selected, onSelect,
}: {
  blocks:     Block[]
  blockCosts: BlockCost[]
  selected:   number
  onSelect:   (blockIndex: number) => void
}) {
  const [hovered, setHovered] = useState<{ idx: number; x: number; side: 'left' | 'right' } | null>(null)

  const costs = blocks.map(b => {
    const bc = blockCosts[b.index - 1]
    return bc ? bc.inputUsd + bc.outputUsd : 0
  })
  const maxCost = Math.max(...costs, 0.000001)
  const total   = costs.reduce((a, c) => a + c, 0)
  const hasData = costs.some(c => c > 0)
  if (!hasData) return null

  const BAR_MAX = 40

  return (
    <div style={{ borderBottom: '1px solid #21262d', background: '#090d12', padding: '8px 16px 0', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#484f58', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
        <span>Cost per block</span>
        <span style={{ color: '#6e7681' }}>total {fmtUsd(total)}</span>
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3, height: BAR_MAX }}>
        {blocks.map((block, i) => {
          const cost    = costs[i]
          const bc      = blockCosts[block.index - 1]
          const inProg  = !block.hasStop && i === blocks.length - 1
          const isSel   = block.index === selected
          const isMax   = cost === maxCost && cost > 0
          const barH    = cost > 0 ? Math.max(4, (cost / maxCost) * BAR_MAX) : 4
          const color   = inProg ? '#d29922' : isSel ? '#58a6ff' : '#1f6feb'
          return (
            <div
              key={block.index}
              onClick={() => onSelect(block.index)}
              style={{
                flex: 1, maxWidth: 28, minWidth: 5,
                height: barH, alignSelf: 'flex-end',
                background: cost > 0 ? color : '#1a1f26',
                borderRadius: '2px 2px 0 0',
                cursor: 'pointer',
                opacity: isSel ? 1 : isMax ? 0.85 : 0.45,
                transition: 'opacity 0.15s, background 0.15s',
                outline: isSel ? `2px solid ${color}` : 'none',
                outlineOffset: 1,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.opacity = '1'
                const rect = e.currentTarget.getBoundingClientRect()
                const parent = e.currentTarget.parentElement!.getBoundingClientRect()
                const x = rect.left - parent.left + rect.width / 2
                setHovered({ idx: i, x, side: x > parent.width / 2 ? 'right' : 'left' })
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = isSel ? '1' : isMax ? '0.85' : '0.45'
                setHovered(null)
              }}
            />
          )
        })}
        {/* Floating tooltip */}
        {hovered !== null && (() => {
          const i   = hovered.idx
          const bc  = blockCosts[blocks[i].index - 1]
          const c   = costs[i]
          const totTok = bc ? bc.inputTokens + bc.outputTokens : 0
          return (
            <div style={{
              position: 'absolute',
              bottom: BAR_MAX + 6,
              left: hovered.side === 'left' ? hovered.x : undefined,
              right: hovered.side === 'right' ? `calc(100% - ${hovered.x}px)` : undefined,
              transform: hovered.side === 'left' ? 'translateX(-30%)' : 'translateX(30%)',
              background: '#1c2128',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 10,
              color: '#c9d1d9',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 2 }}>
                #{blocks[i].index} — {c > 0 ? fmtUsd(c) : 'no data'}
              </div>
              {bc && (
                <>
                  <div style={{ color: '#8b949e' }}>
                    <span style={{ color: '#79c0ff' }}>In</span>{'  '}
                    {fmtTok(bc.inputTokens)} tok · {fmtUsd(bc.inputUsd)}
                  </div>
                  <div style={{ color: '#8b949e' }}>
                    <span style={{ color: '#56d364' }}>Out</span>{'  '}
                    {fmtTok(bc.outputTokens)} tok · {fmtUsd(bc.outputUsd)}
                  </div>
                  <div style={{ borderTop: '1px solid #21262d', marginTop: 3, paddingTop: 3, color: '#6e7681' }}>
                    Total {fmtTok(totTok)} tok
                  </div>
                </>
              )}
            </div>
          )
        })()}
      </div>
      {blocks.length <= 16 && (
        <div style={{ display: 'flex', gap: 3, marginTop: 2, marginBottom: 1 }}>
          {blocks.map(block => (
            <div key={block.index} style={{ flex: 1, maxWidth: 28, minWidth: 5, textAlign: 'center', fontSize: 8, color: block.index === selected ? '#6e7681' : '#2d3138' }}>
              {block.index}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
