import { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { TraceEvent } from '../types'

interface Props {
  events:    TraceEvent[]
  startedAt: number
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️', Bash: '🖥️',
  Glob: '🔍', Grep: '🔎', WebSearch: '🌐', WebFetch: '🌐',
  Agent: '🤖', Skill: '⚡', TodoWrite: '📝', TodoRead: '📝',
  Task: '📋', default: '🔧',
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#58a6ff', Write: '#3fb950', Edit: '#3fb950', Bash: '#d29922',
  Glob: '#79c0ff', Grep: '#79c0ff', WebSearch: '#bc8cff', WebFetch: '#bc8cff',
  Agent: '#d29922', Skill: '#58a6ff', default: '#7d8590',
}

function fmtMs(ms?: number): string {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function buildGraph(events: TraceEvent[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  let blockIndex = 0
  let toolIndex  = 0
  let lastNodeId: string | null = null
  let blockStartId: string | null = null

  // Block separator node style
  const sepStyle: React.CSSProperties = {
    background: '#161b22',
    border: '1px solid #21262d',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 10,
    color: '#7d8590',
  }

  for (const ev of events) {
    if (ev.type === 'SessionStart') continue

    if (ev.type === 'Stop') {
      blockIndex++
      lastNodeId    = null
      blockStartId  = null
      toolIndex     = 0
      continue
    }

    if (ev.type !== 'PreToolUse' && ev.type !== 'Done') continue

    // Crear nodo separador al inicio de un nuevo bloque
    if (blockStartId === null) {
      const sepId = `block-${blockIndex}`
      nodes.push({
        id:       sepId,
        type:     'default',
        position: { x: blockIndex * 220, y: 0 },
        data:     { label: <div style={sepStyle}>Respuesta #{blockIndex + 1}</div> },
        style:    { background: 'transparent', border: 'none', padding: 0 },
      })
      blockStartId = sepId
      lastNodeId   = sepId
    }

    const nodeId  = `${blockIndex}-${toolIndex}`
    const isDone  = ev.type === 'Done'
    const color   = TOOL_COLORS[ev.tool_name || ''] ?? TOOL_COLORS.default
    const icon    = TOOL_ICONS[ev.tool_name || '']  ?? TOOL_ICONS.default

    nodes.push({
      id:       nodeId,
      position: { x: blockIndex * 220, y: (toolIndex + 1) * 80 },
      data: {
        label: (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '4px 8px',
          }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color }}>{ev.tool_name}</span>
            {isDone && ev.duration_ms && (
              <span style={{ fontSize: 9, color: '#7d8590' }}>{fmtMs(ev.duration_ms)}</span>
            )}
          </div>
        )
      },
      style: {
        background:  isDone ? '#0d1117' : '#1c2128',
        border:      `2px solid ${isDone ? color : color + '66'}`,
        borderRadius: 8,
        width:        100,
        opacity:      isDone ? 1 : 0.75,
        boxShadow:    isDone ? `0 0 8px ${color}44` : undefined,
      },
    })

    if (lastNodeId) {
      edges.push({
        id:             `e-${lastNodeId}-${nodeId}`,
        source:         lastNodeId,
        target:         nodeId,
        animated:       !isDone,
        style:          { stroke: isDone ? color + '88' : color },
        markerEnd:      { type: MarkerType.ArrowClosed, color: isDone ? color + '88' : color },
      })
    }

    lastNodeId = nodeId
    toolIndex++
  }

  return { nodes, edges }
}

export function DAGView({ events }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(events), [events])

  const dagStyle: React.CSSProperties = {
    background: '#0d1117',
    height: '100%',
  }

  return (
    <div style={{ height: '100%', background: '#0d1117' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        style={dagStyle}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#21262d" gap={20} />
        <Controls style={{ background: '#161b22', border: '1px solid #21262d' }} />
        <MiniMap
          style={{ background: '#161b22', border: '1px solid #21262d' }}
          nodeColor={() => '#1f6feb'}
          maskColor="#0d111788"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#7d8590', fontSize: 12, pointerEvents: 'none',
        }}>
          El grafo de ejecución aparecerá aquí en tiempo real
        </div>
      )}
    </div>
  )
}
