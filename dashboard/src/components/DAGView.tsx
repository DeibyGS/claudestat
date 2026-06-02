import { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CostInfo, SubAgentSession, SessionState, TraceEvent } from '../types'
import { shortModel } from './shared'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  cost?:             CostInfo
  subAgentSessions:  SubAgentSession[]
  sessionState?:     SessionState
  events:            TraceEvent[]
  cliLabel?:         string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelColor(model?: string): string {
  if (!model) return '#7d8590'
  if (model.includes('opus'))     return '#d29922'
  if (model.includes('haiku'))    return '#3fb950'
  if (model.includes('sonnet'))   return '#58a6ff'
  if (model.includes('deepseek')) return '#c9a0ff'
  return '#8b949e'
}

function fmtCostNode(usd?: number): string {
  if (!usd || usd <= 0) return '—'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildAgentGraph(
  cost:              CostInfo | undefined,
  subAgentSessions:  SubAgentSession[],
  sessionState:      SessionState,
  events:            TraceEvent[],
  cliLabel:          string,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Count unmatched Agent PreToolUse → how many sub-agents currently running
  let openAgents = 0
  for (const e of events) {
    if (e.type === 'PreToolUse' && e.tool_name === 'Agent') openAgents++
    if (e.type === 'Done'       && e.tool_name === 'Agent') openAgents--
  }
  const hasRunningAgent = openAgents > 0

  const rootState   = sessionState
  const rootColor   = rootState === 'working' ? '#3fb950' : rootState === 'waiting_for_input' ? '#58a6ff' : '#7d8590'
  const rootModel   = cost?.model ? shortModel(cost.model) : '—'
  const rootMColor  = modelColor(cost?.model)
  const rootY       = subAgentSessions.length > 1 ? ((subAgentSessions.length - 1) * 120) / 2 : 0

  // ── Root node ──
  nodes.push({
    id:       'root',
    position: { x: 0, y: rootY },
    data: {
      label: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 12px', minWidth: 148 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: rootColor, flexShrink: 0,
              boxShadow: rootState === 'working' ? `0 0 6px ${rootColor}` : undefined,
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e6edf3' }}>{cliLabel}</span>
          </div>
          <span style={{ fontSize: 10, color: rootMColor, fontWeight: 600 }}>{rootModel}</span>
          {(cost?.cost_usd ?? 0) > 0 && (
            <span style={{ fontSize: 10, color: '#6e7681' }}>{fmtCostNode(cost!.cost_usd)}</span>
          )}
          <span style={{ fontSize: 9, color: rootColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {rootState === 'working' ? '● working' : rootState === 'waiting_for_input' ? '◎ waiting' : '○ idle'}
          </span>
        </div>
      ),
    },
    style: {
      background: '#0d1117',
      border: `2px solid ${rootColor}66`,
      borderRadius: 8,
      padding: 0,
      boxShadow: rootState === 'working' ? `0 0 14px ${rootColor}22` : undefined,
    },
  })

  // ── Sub-agent nodes ──
  subAgentSessions.forEach((s, i) => {
    const isLast    = i === subAgentSessions.length - 1
    const isWorking = isLast && hasRunningAgent
    const hasCost   = (s.total_cost_usd ?? 0) > 0
    const mColor    = modelColor(s.dominant_model)
    const mLabel    = s.dominant_model ? shortModel(s.dominant_model) : '—'
    const nodeId    = `agent-${i}`
    const edgeColor = isWorking ? '#d29922' : hasCost ? '#3fb95055' : '#21262d'

    nodes.push({
      id:       nodeId,
      position: { x: 300, y: i * 120 },
      data: {
        label: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px', minWidth: 136 }}>
            <span style={{ fontSize: 9, color: '#484f58', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sub-agent #{i + 1}
            </span>
            <span style={{ fontSize: 10, color: mColor, fontWeight: 700 }}>{mLabel}</span>
            <span style={{ fontSize: 10, color: hasCost ? '#6e7681' : '#3d444d' }}>{fmtCostNode(s.total_cost_usd)}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: isWorking ? '#d29922' : hasCost ? '#3fb950' : '#484f58',
            }}>
              {isWorking ? '● working' : hasCost ? '✓ done' : '○ queued'}
            </span>
          </div>
        ),
      },
      style: {
        background: '#090d12',
        border: `2px solid ${isWorking ? '#d29922' : hasCost ? '#3fb95033' : '#21262d'}`,
        borderRadius: 8,
        padding: 0,
        opacity: hasCost || isWorking ? 1 : 0.55,
      },
    })

    edges.push({
      id:       `e-root-${nodeId}`,
      source:   'root',
      target:   nodeId,
      animated: isWorking,
      style:    { stroke: edgeColor, strokeWidth: isWorking ? 1.5 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    })
  })

  return { nodes, edges }
}

// ─── DAGView ─────────────────────────────────────────────────────────────────

export function DAGView({
  cost, subAgentSessions, sessionState = 'idle', events, cliLabel = 'Claude Code',
}: Props) {
  const { nodes, edges } = useMemo(
    () => buildAgentGraph(cost, subAgentSessions, sessionState, events, cliLabel),
    [cost, subAgentSessions, sessionState, events, cliLabel],
  )

  return (
    <div style={{ height: '100%', background: '#0d1117', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        style={{ background: '#0d1117' }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="#1a1f26" gap={24} />
        <Controls style={{ background: '#161b22', border: '1px solid #21262d' }} />
        {subAgentSessions.length > 5 && (
          <MiniMap
            style={{ background: '#161b22', border: '1px solid #21262d' }}
            nodeColor={() => '#1f6feb'}
            maskColor="#0d111788"
          />
        )}
      </ReactFlow>

      {subAgentSessions.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <div style={{ fontSize: 13, color: '#6e7681', fontWeight: 500 }}>No sub-agents in this session</div>
          <div style={{ fontSize: 11, color: '#3d444d' }}>Agent tool calls will appear here in real time</div>
        </div>
      )}
    </div>
  )
}
