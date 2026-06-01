import { useEffect, useState } from 'react'
import { X, AlertCircle, ChevronRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import type { AssistantTurnData, AgentNode } from '../types'

interface ReplayData {
  turns:          AssistantTurnData[]
  context_window: number
}

interface Props {
  sessionId: string
  onClose:   () => void
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function AgentTreeNode({ node, depth = 0 }: { node: AgentNode; depth?: number }) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div
        onClick={() => hasChildren && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 6px', borderRadius: 4,
          background: depth === 0 ? '#1f2937' : 'transparent',
          cursor: hasChildren ? 'pointer' : 'default',
        }}
      >
        {hasChildren && (
          <ChevronRight size={10} color="#7d8590" style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
        )}
        {!hasChildren && <div style={{ width: 10 }} />}
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#79c0ff' }}>{node.id.slice(0, 8)}</span>
        {node.dominant_model && (
          <span style={{ fontSize: 9, color: '#7d8590' }}>{node.dominant_model.replace('claude-', '')}</span>
        )}
        {node.total_cost_usd != null && (
          <span style={{ fontSize: 10, color: '#3fb950', marginLeft: 'auto' }}>${node.total_cost_usd.toFixed(4)}</span>
        )}
      </div>
      {open && node.children.map(child => (
        <AgentTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function ReplayModal({ sessionId, onClose }: Props) {
  const [replay,    setReplay]    = useState<ReplayData | null>(null)
  const [agentTree, setAgentTree] = useState<AgentNode | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/session/${sessionId}/replay`).then(r => r.json()),
      fetch(`/session/${sessionId}/agent-tree`).then(r => r.json()),
    ]).then(([rd, tree]) => {
      setReplay(rd)
      setAgentTree(tree)
      setLoading(false)
    }).catch((err) => {
      setError(String(err))
      setLoading(false)
    })
  }, [sessionId])

  const chartData = (replay?.turns ?? []).map(t => ({
    turn: t.turn_index,
    ctx:  t.context_used,
    pct:  replay ? Math.round(t.context_used / replay.context_window * 100) : 0,
  }))
  const warn90 = replay ? Math.round(replay.context_window * 0.9 / 1000) : 180

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: '#00000099',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '92vw', maxWidth: 1000, maxHeight: '88vh',
          background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderBottom: '1px solid #21262d',
        }}>
          <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 13 }}>Session Replay</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#7d8590' }}>{sessionId.slice(0, 8)}</span>
          {replay && (
            <span style={{ fontSize: 10, color: '#484f58' }}>
              {replay.turns.length} turn{replay.turns.length !== 1 ? 's' : ''}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        {loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7d8590', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {!loading && !replay && error && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f85149', fontSize: 12, padding: 24, textAlign: 'center' }}>
            Failed to load replay data: {error}
          </div>
        )}

        {!loading && replay && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {/* Turn list */}
            <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #21262d', padding: '8px 0' }}>
              {replay.turns.length === 0 && (
                <div style={{ padding: 24, color: '#484f58', fontSize: 12, textAlign: 'center' }}>
                  No turns recorded yet — semantic extraction runs 3s after the last assistant response.
                </div>
              )}
              {replay.turns.map(turn => {
                const ctxPct = Math.round(turn.context_used / replay.context_window * 100)
                const ctxColor = ctxPct >= 90 ? '#f85149' : ctxPct >= 70 ? '#d29922' : '#3fb950'
                return (
                  <div key={turn.turn_index} style={{
                    padding: '8px 14px', borderBottom: '1px solid #161b22',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace', minWidth: 20 }}>#{turn.turn_index}</span>
                      {turn.error_count > 0 && (
                        <AlertCircle size={10} color="#f85149" />
                      )}
                      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {turn.tool_calls.map((tc, i) => (
                          <span key={i} style={{
                            fontSize: 9, color: '#58a6ff', background: '#58a6ff18',
                            border: '1px solid #58a6ff30', borderRadius: 3, padding: '1px 5px',
                          }}>{tc}</span>
                        ))}
                      </div>
                      <span style={{ fontSize: 9, color: ctxColor, fontFamily: 'monospace', flexShrink: 0 }}>
                        {fmtTok(turn.context_used)} · {ctxPct}%
                      </span>
                    </div>
                    {turn.text_preview && (
                      <div style={{
                        fontSize: 10, color: '#8b949e', lineHeight: 1.5,
                        fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                        overflow: 'hidden', maxHeight: 48,
                      }}>
                        {turn.text_preview}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Right panel: chart + agent tree */}
            <div style={{ width: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Context Decay Curve */}
              <div style={{ padding: '10px 14px 4px', borderBottom: '1px solid #21262d' }}>
                <div style={{ fontSize: 10, color: '#7d8590', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Context Decay
                </div>
                {chartData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <XAxis dataKey="turn" tick={{ fontSize: 9, fill: '#484f58' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: '#484f58' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 10 }}
                        labelFormatter={v => `Turn ${v}`}
                        formatter={(v: number) => [`${v}%`, 'Context']}
                      />
                      <ReferenceLine y={90} stroke="#f8514940" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="pct" stroke="#58a6ff" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 11 }}>
                    Need ≥2 turns for chart
                  </div>
                )}
              </div>

              {/* Agent Tree */}
              {agentTree && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#7d8590', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Agent Tree
                  </div>
                  <AgentTreeNode node={agentTree} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
