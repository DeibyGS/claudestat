import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Terminal } from 'lucide-react'
import type { TraceEvent, CostInfo, BlockCost, MetaStats, QuotaData, SessionState, DayStats, QuotaStats, SubAgentSession } from '../../types'
import { groupBlocks } from './utils'
import type { HiddenCostStats, SessionPromptItem } from './utils'
import { SidebarKPI } from './SidebarKPI'
import { SidebarStats } from './SidebarStats'
import { CostTimeline } from './CostTimeline'
import { BlockListItem } from './BlockListItem'
import { BlockDetailPanel } from './BlockDetailPanel'

// Re-export public API consumed by App.tsx
export { maskSecrets } from './utils'

interface Props {
  events:             TraceEvent[]
  startedAt:          number
  cost?:              CostInfo
  blockCosts?:        BlockCost[]
  meta?:              MetaStats
  quota?:             QuotaData
  sessionState?:      SessionState
  weeklyData:         DayStats[]
  prompts?:           SessionPromptItem[]
  hiddenCost?:        HiddenCostStats
  quotaStats?:        QuotaStats
  subAgentSessions?:  SubAgentSession[]
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TracePanel({ events, startedAt, cost, blockCosts = [], meta, quota, sessionState = 'idle', weeklyData = [], hiddenCost, prompts = [], quotaStats, subAgentSessions = [] }: Props) {
  const listRef        = useRef<HTMLDivElement>(null)
  // null = auto-follow last block
  const [pinned, setPinned] = useState<number | null>(null)

  // Memoizar groupBlocks: es O(n) sobre events y no debe recalcularse en renders sin cambios
  const blocks    = useMemo(() => groupBlocks(events), [events])
  // Single-pass: finds max y min cost en un solo loop, solo bloques completados con tools
  const { maxCostIdx, minCostIdx } = useMemo(() => {
    let maxIdx = -1, minIdx = -1, maxCost = -Infinity, minCost = Infinity, eligible = 0
    for (const block of blocks) {
      if (!block.hasStop || block.tools.length === 0) continue
      const bc   = blockCosts[block.index - 1]
      const cost = (bc?.inputUsd ?? 0) + (bc?.outputUsd ?? 0)
      if (cost <= 0) continue
      eligible++
      if (cost > maxCost) { maxCost = cost; maxIdx = block.index }
      if (cost < minCost) { minCost = cost; minIdx = block.index }
    }
    return { maxCostIdx: maxIdx, minCostIdx: eligible > 1 ? minIdx : -1 }
  }, [blocks, blockCosts])
  const lastIdx     = blocks.length > 0 ? blocks[blocks.length - 1].index : 1
  const selectedIdx = pinned ?? lastIdx

  // Auto-scroll list to bottom when new block appears and not pinned
  useEffect(() => {
    if (pinned === null) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [blocks.length, pinned])

  const handleSelect = useCallback((blockIndex: number) => {
    const isLast = blocks.length > 0 && blockIndex === blocks[blocks.length - 1].index
    setPinned(isLast ? null : blockIndex)
  }, [blocks])

  const selectedBlock = blocks.find(b => b.index === selectedIdx) ?? blocks[blocks.length - 1]

  if (blocks.length === 0) {
    return (
      <div style={{ background: '#0d1117', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#484f58' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.25 }}>
            <Terminal size={36} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#6e7681', marginBottom: 4 }}>Esperando actividad…</div>
          <div style={{ fontSize: 11 }}>Abre Claude Code y empieza a trabajar</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', flex: 1, background: '#0d1117', overflow: 'hidden' }}>
      <style>{`
        @keyframes spin        { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes borderPulse { 0%,100% { border-left-color: #d29922 } 50% { border-left-color: #d2992255 } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
        @keyframes ctxPulse { 0%,100%{opacity:1;box-shadow:0 0 4px #f8514988} 50%{opacity:.6;box-shadow:0 0 10px #f85149cc} }
      `}</style>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 360, flexShrink: 0,
        borderRight: '1px solid #21262d',
        display: 'flex', flexDirection: 'column',
        background: '#090d12', overflow: 'hidden',
      }}>
        {/* KPI section */}
        <SidebarKPI cost={cost} quota={quota} sessionState={sessionState} meta={meta} quotaStats={quotaStats} startedAt={startedAt} promptCount={prompts.length} />

        {/* Cost Timeline inside sidebar */}
        <CostTimeline blocks={blocks} blockCosts={blockCosts} selected={selectedIdx} onSelect={handleSelect} />

        {/* Block list (scrollable) */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 4 }}>
          {blocks.map((block, idx) => (
            <BlockListItem
              key={block.index}
              block={block}
              blockCost={blockCosts[block.index - 1]}
              isLast={idx === blocks.length - 1}
              isSelected={block.index === selectedIdx}
              heatRole={block.index === maxCostIdx ? 'max' : block.index === minCostIdx ? 'min' : undefined}
              onClick={() => handleSelect(block.index)}
            />
          ))}

        </div>

        {/* Session stats at bottom */}
        <SidebarStats cost={cost} weeklyData={weeklyData} events={events} hiddenCost={hiddenCost} prompts={prompts} subAgentSessions={subAgentSessions} />
      </div>

      {/* ── Right: block detail (full width) ── */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#0d1117' }}>
        {selectedBlock
          ? (
            <BlockDetailPanel
              key={selectedBlock.index}
              block={selectedBlock}
              startedAt={startedAt}
              blockCost={blockCosts[selectedBlock.index - 1]}
              sessionModel={cost?.model}
              prompt={prompts.find(p => p.index === selectedBlock.index)?.text}
            />
          )
          : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 12 }}>
              Select a block
            </div>
          )
        }
      </div>
    </div>
  )
}
