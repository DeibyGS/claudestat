import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Terminal } from 'lucide-react'
import type { TraceEvent, CostInfo, BlockCost, MetaStats, QuotaData, SessionState, DayStats, QuotaStats, SubAgentSession } from '../../types'
import { groupBlocks } from './utils'
import type { HiddenCostStats, SessionPromptItem } from './utils'
import { SidebarKPI } from './SidebarKPI'
import type { OcModelUsage } from './SidebarKPI'
import { KPICards } from './KPICards'
import { SidebarStats } from './SidebarStats'
import { ContextCurve } from './ContextCurve'
import { BlockListItem } from './BlockListItem'
import { BlockDetailPanel } from './BlockDetailPanel'

const DAGView = lazy(() => import('../DAGView').then(m => ({ default: m.DAGView })))

// Re-export public API consumed by App.tsx
export { maskSecrets } from './utils'

interface Props {
  events:                TraceEvent[]
  startedAt:             number
  cost?:                 CostInfo
  blockCosts?:           BlockCost[]
  meta?:                 MetaStats
  quota?:                QuotaData
  sessionState?:         SessionState
  weeklyData:            DayStats[]
  prompts?:              SessionPromptItem[]
  hiddenCost?:           HiddenCostStats
  quotaStats?:           QuotaStats
  subAgentSessions?:     SubAgentSession[]
  cliLabel?:             string
  burnRateTokensPerMin?: number
  ocModelUsage?:         OcModelUsage[]
}

// ─── Main component ───────────────────────────────────────────────────────────

function toActorLabel(model?: string): string {
  if (!model) return 'Claude'
  const seg = model.split(/[-/]/)[0].toLowerCase()
  return seg === 'claude' ? 'Claude' : seg.charAt(0).toUpperCase() + seg.slice(1)
}

export function TracePanel({ events, startedAt, cost, blockCosts = [], meta, quota, sessionState = 'idle', weeklyData = [], hiddenCost, prompts = [], quotaStats, subAgentSessions = [], cliLabel = 'Claude Code', burnRateTokensPerMin, ocModelUsage }: Props) {
  const actorLabel = toActorLabel(cost?.model)
  const listRef        = useRef<HTMLDivElement>(null)
  // null = auto-follow last block
  const [pinned, setPinned] = useState<number | null>(null)
  const [flowTab, setFlowTab] = useState<'session' | 'flow'>('session')

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

  const agentCount = useMemo(
    () => events.filter(e => e.type === 'PreToolUse' && e.tool_name === 'Agent').length,
    [events],
  )

  // Auto-scroll list to bottom when new block appears and not pinned
  useEffect(() => {
    if (pinned === null) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [blocks.length, pinned])

  useEffect(() => {
    if (agentCount === 0) setFlowTab('session')
  }, [agentCount])

  const handleSelect = useCallback((blockIndex: number) => {
    const isLast = blocks.length > 0 && blockIndex === blocks[blocks.length - 1].index
    setPinned(isLast ? null : blockIndex)
  }, [blocks])

  const selectedBlock = blocks.find(b => b.index === selectedIdx) ?? blocks[blocks.length - 1]

  const selectedPrompt = useMemo(() => {
    if (!selectedBlock || prompts.length === 0) return undefined
    const blockStart = selectedBlock.tools[0]?.ts
    if (!blockStart) return prompts.find(p => p.index === selectedBlock.index)
    let best: SessionPromptItem | undefined
    for (const p of prompts) {
      if (p.ts <= blockStart && (!best || p.ts > best.ts)) best = p
    }
    return best
  }, [selectedBlock, prompts])

  if (blocks.length === 0) {
    const emptyPane = (
      <div style={{ background: '#0d1117', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#484f58' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: 0.25 }}>
            <Terminal size={36} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#6e7681', marginBottom: 4 }}>
            {cost ? 'Waiting for next message…' : 'Waiting for activity…'}
          </div>
          <div style={{ fontSize: 11 }}>
            {cost ? `${cliLabel} is ready — session active` : `Open ${cliLabel} and start working`}
          </div>
        </div>
      </div>
    )
    if (!cost) return emptyPane
    return (
      <div style={{ display: 'flex', height: '100%', flex: 1, background: '#0d1117', overflow: 'hidden' }}>
        <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', background: '#090d12', overflow: 'hidden' }}>
          <SidebarKPI cost={cost} quota={quota} sessionState={sessionState} meta={meta} ocModelUsage={ocModelUsage} startedAt={startedAt} burnRateTokensPerMin={burnRateTokensPerMin} />
        </div>
        {emptyPane}
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
        <SidebarKPI cost={cost} quota={quota} sessionState={sessionState} meta={meta} ocModelUsage={ocModelUsage} startedAt={startedAt} burnRateTokensPerMin={burnRateTokensPerMin} />

        {/* Context degradation curve */}
        <ContextCurve blocks={blocks} blockCosts={blockCosts} />

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
              defaultActorLabel={actorLabel}
            />
          ))}

        </div>

        {/* Session stats at bottom */}
        <SidebarStats cost={cost} weeklyData={weeklyData} events={events} hiddenCost={hiddenCost} prompts={prompts} subAgentSessions={subAgentSessions} />
      </div>

      {/* ── Right: block detail (full width) ── */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#0d1117', display: 'flex', flexDirection: 'column' }}>
        {/* KPI Cards */}
        <KPICards cost={cost} promptCount={prompts.length} blockCosts={blockCosts} sessionState={sessionState} burnRateTokensPerMin={burnRateTokensPerMin} />

        {/* Source badge + sub-tabs */}
        <div style={{
          flexShrink: 0, padding: '4px 14px', borderBottom: '1px solid #21262d',
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
          background: '#090d12', color: '#7d8590',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: cliLabel === 'OpenCode' ? '#3fb950' : '#58a6ff',
            display: 'inline-block', flexShrink: 0,
          }} />
          {cliLabel}
          <span style={{ color: '#484f58' }}>·</span>
          {agentCount > 0 ? (
            <>
              <button
                onClick={() => setFlowTab('session')}
                style={{
                  border: 'none', cursor: 'pointer', padding: '1px 6px',
                  fontSize: 10, borderRadius: 4, fontFamily: 'inherit',
                  color: flowTab === 'session' ? '#e6edf3' : '#7d8590',
                  background: flowTab === 'session' ? '#1f6feb33' : 'transparent',
                }}
              >
                Session
              </button>
              <button
                onClick={() => setFlowTab('flow')}
                style={{
                  border: 'none', cursor: 'pointer', padding: '1px 6px',
                  fontSize: 10, borderRadius: 4, fontFamily: 'inherit',
                  color: flowTab === 'flow' ? '#e6edf3' : '#7d8590',
                  background: flowTab === 'flow' ? '#1f6feb33' : 'transparent',
                }}
              >
                Flow ({agentCount})
              </button>
            </>
          ) : (
            'Block view'
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {flowTab === 'flow' ? (
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 12 }}>Loading…</div>}>
              <DAGView
                cost={cost}
                subAgentSessions={subAgentSessions}
                sessionState={sessionState}
                events={events}
                cliLabel={cliLabel}
              />
            </Suspense>
          ) : selectedBlock ? (
            <BlockDetailPanel
              key={selectedBlock.index}
              block={selectedBlock}
              startedAt={startedAt}
              blockCost={blockCosts[selectedBlock.index - 1]}
              sessionModel={cost?.model}
              prompt={selectedPrompt?.text}
              defaultActorLabel={actorLabel}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 12 }}>
              Select a block
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
