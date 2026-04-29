import { useEffect } from 'react'
import { X, TriangleAlert } from 'lucide-react'
import type { TraceEvent } from '../../types'
import { TOOL_ICONS, TOOL_COLORS, fmtMs, fmtJson, checkDangerous, maskSecrets } from './utils'

// ─── Diff View ────────────────────────────────────────────────────────────────

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, borderRadius: 6, overflow: 'auto', border: '1px solid #30363d', maxHeight: 320 }}>
      <div style={{ background: '#161b22', borderBottom: '1px solid #30363d', padding: '3px 10px', display: 'flex', gap: 10, fontSize: 10 }}>
        <span style={{ color: '#f85149', fontWeight: 600 }}>— before</span>
        <span style={{ color: '#3d444d' }}>·</span>
        <span style={{ color: '#3fb950', fontWeight: 600 }}>+ after</span>
      </div>
      {oldLines.map((line, i) => (
        <div key={`-${i}`} style={{ background: '#3d1c1c', padding: '1px 10px', display: 'flex', gap: 8, minHeight: 18 }}>
          <span style={{ color: '#f85149', userSelect: 'none', flexShrink: 0, fontWeight: 700 }}>-</span>
          <span style={{ color: '#ffa198', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</span>
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`+${i}`} style={{ background: '#1a2d1a', padding: '1px 10px', display: 'flex', gap: 8, minHeight: 18 }}>
          <span style={{ color: '#3fb950', userSelect: 'none', flexShrink: 0, fontWeight: 700 }}>+</span>
          <span style={{ color: '#7ee787', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

export function DetailModal({ ev, onClose }: { ev: TraceEvent; onClose: () => void }) {
  const Icon  = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
  const color = TOOL_COLORS[ev.tool_name || ''] || TOOL_COLORS.default
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#00000088',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#161b22', border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`, borderRadius: 10,
        width: '100%', maxWidth: 700, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 32px #00000099, 0 0 0 1px ${color}20`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #30363d', flexShrink: 0,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', color }}><Icon size={16} /></span>
          <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>
            {ev.tool_name || ev.type}
            {ev.tool_name === 'Agent' && ev.tool_input && (() => {
              try {
                const inp = JSON.parse(ev.tool_input)
                const t   = inp.subagent_type || inp.description
                return t
                  ? <span style={{ color: '#bc8cff', fontSize: 12, fontWeight: 500, marginLeft: 6 }}>› {t}</span>
                  : null
              } catch { return null }
            })()}
          </span>
          {ev.duration_ms && (
            <span style={{ fontSize: 11, color: '#6e7681', background: '#21262d', borderRadius: 4, padding: '1px 6px' }}>
              {fmtMs(ev.duration_ms)}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#6e7681', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4,
          }}><X size={16} /></button>
        </div>
        <div style={{ overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Guardrail alert */}
          {(() => {
            const danger = checkDangerous(ev.tool_name, ev.tool_input)
            if (!danger) return null
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#3d1717', border: '1px solid #f8514960', borderRadius: 6, padding: '8px 12px' }}>
                <TriangleAlert size={14} color="#f85149" />
                <div>
                  <span style={{ color: '#f85149', fontWeight: 700, fontSize: 12 }}>Dangerous command detected — {danger}</span>
                  <span style={{ color: '#8b949e', fontSize: 11, marginLeft: 8 }}>Verify that this operation is intentional</span>
                </div>
              </div>
            )
          })()}

          {/* Input — diff para Edit, raw para el resto */}
          {ev.tool_input && (() => {
            if (ev.tool_name === 'Edit') {
              try {
                const inp = JSON.parse(ev.tool_input)
                if (inp.old_string !== undefined && inp.new_string !== undefined) {
                  return (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                        Diff — {inp.file_path ? <span style={{ color: '#79c0ff', fontWeight: 400, textTransform: 'none' }}>{inp.file_path.split('/').pop()}</span> : null}
                      </div>
                      <DiffView oldText={inp.old_string} newText={inp.new_string} />
                    </div>
                  )
                }
              } catch {}
            }
            const formatted = fmtJson(ev.tool_input)
            if (!formatted) return null
            return (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Input</div>
                <pre style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#c9d1d9', margin: 0, overflow: 'auto', maxHeight: 220, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {formatted}
                </pre>
              </div>
            )
          })()}
          {ev.tool_output && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#3fb950', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Output
              </div>
              <pre style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#c9d1d9', margin: 0, overflow: 'auto', maxHeight: 260, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {maskSecrets(ev.tool_output)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
