import { memo } from 'react'
import { FolderOpen, TriangleAlert, Sparkles, GitBranch, Check } from 'lucide-react'
import type { SessionSummary } from '../types'
import { Tip } from './Tip'

interface Props {
  session:     SessionSummary
  isActive?:   boolean
  selectable?: boolean
  selected?:   boolean
  onSelect?:   (id: string) => void
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#58a6ff', Write: '#3fb950', Edit: '#3fb950', Bash: '#d29922',
  Glob: '#79c0ff', Grep: '#79c0ff', WebSearch: '#56d364', WebFetch: '#56d364',
  Agent: '#bc8cff', Skill: '#58a6ff', TodoWrite: '#8b949e', TodoRead: '#8b949e',
  Task: '#8b949e', default: '#6e7681',
}

const MODE_LABEL: Record<string, string> = {
  directo: 'direct', agentes: 'agents', skills: 'skills', 'agentes+skills': 'agents+skills',
}
const MODE_COLOR: Record<string, string> = {
  directo: '#7d8590', agentes: '#d29922', skills: '#58a6ff', 'agentes+skills': '#d29922',
}
const MODE_TOOLTIP: Record<string, string> = {
  directo:          'Claude responded directly, without launching sub-agents or invoking skills',
  agentes:          'Sub-agents (Agent tool) were launched during the session',
  skills:           'Skills (Skill tool) were invoked during the session',
  'agentes+skills': 'Both sub-agents and skills were used in this session',
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(ms: number) {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

const S = {
  card: (active: boolean, selected: boolean): React.CSSProperties => ({
    background: selected ? '#1a2332' : active ? '#1c2128' : '#161b22',
    border: `1px solid ${selected ? '#58a6ff80' : active ? '#1f6feb' : '#21262d'}`,
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  }),
  row:  { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  dim:  { color: '#7d8590', fontSize: 11 },
  badge: (color: string): React.CSSProperties => ({
    color, background: color + '18', border: `1px solid ${color}30`,
    borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 3,
  }),
  sep: { color: '#21262d', userSelect: 'none' as const, fontSize: 11 },
}

function SessionCardInner({ session: s, isActive, selectable, selected = false, onSelect }: Props) {
  const color      = MODE_COLOR[s.mode] ?? '#7d8590'
  const scoreColor = s.efficiency_score >= 90 ? '#3fb950'
    : s.efficiency_score >= 70 ? '#d29922' : '#f85149'

  return (
    <div style={S.card(!!isActive, selected)} onClick={() => selectable && onSelect?.(s.id)}>

      {/* Línea 1: hora · duración · proyecto · modo */}
      <div style={S.row}>
        {selectable && (
          <div style={{
            width: 15, height: 15, borderRadius: 3, flexShrink: 0,
            border: `2px solid ${selected ? '#58a6ff' : '#484f58'}`,
            background: selected ? '#58a6ff' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {selected && <Check size={9} color="#0d1117" strokeWidth={3} />}
          </div>
        )}
        {isActive && (
          <span style={{ color: '#3fb950', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', animation: 'livePulse 1.2s ease-in-out infinite', display: 'inline-block' }} />
            LIVE
          </span>
        )}
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Session interval</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Time of first event → last recorded event</div>
          </div>
        }>
          <span style={S.dim}>{fmtTime(s.started_at)} → {fmtTime(s.last_event_at)}</span>
        </Tip>
        <span style={S.dim}>·</span>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Duration</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Elapsed time from the first to the last event in the session</div>
          </div>
        }>
          <span style={{ ...S.dim, fontWeight: 600 }}>{fmtDuration(s.duration_ms)}</span>
        </Tip>
        {s.project_name && (
          <>
            <span style={S.sep}>│</span>
            <span style={{ color: '#79c0ff', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <FolderOpen size={10} /> {s.project_name}
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <Tip position="top" align="right" content={
          <div>
            <div style={{ color, fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{MODE_LABEL[s.mode] ?? s.mode}</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>{MODE_TOOLTIP[s.mode] ?? s.mode}</div>
          </div>
        }>
          <span style={S.badge(color)}>{MODE_LABEL[s.mode] ?? s.mode}</span>
        </Tip>
      </div>

      {/* Línea 2: coste · tokens · eficiencia · loops */}
      <div style={S.row}>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>API Cost</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Sum of all session blocks at Anthropic pricing</div>
          </div>
        }>
          <span style={S.badge('#3fb950')}>${s.total_cost_usd.toFixed(4)}</span>
        </Tip>
        <span style={S.dim}>·</span>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#79c0ff', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total tokens</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
              Input + Output + Cache read.<br />
              Cache read dominates in long sessions — it's the context resent on each API call.
            </div>
          </div>
        }>
          <span style={{
            color: '#79c0ff', background: '#79c0ff22', border: '1px solid #79c0ff50',
            borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            {fmtTok(s.total_tokens)} tok
          </span>
        </Tip>
        <span style={S.sep}>│</span>
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: scoreColor, fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Efficiency {s.efficiency_score}/100</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
              Score calculated by the daemon.<br />
              Penalizes detected loops, re-reads of the same file, and excessive context use.
            </div>
          </div>
        }>
          <span style={S.badge(scoreColor)}>efficiency {s.efficiency_score}/100</span>
        </Tip>
        {s.loops_detected > 0 && (
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#f85149', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Detected loops</div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.6 }}>
                {s.loops_detected} loop{s.loops_detected !== 1 ? 's' : ''} in this session.<br />
                Detected when the same action (tool + input) repeats ≥3 times without real progress.
              </div>
            </div>
          }>
            <span style={S.badge('#f85149')}>
              <TriangleAlert size={9} /> {s.loops_detected} loops
            </span>
          </Tip>
        )}
        <span style={S.sep}>│</span>
        <Tip position="top" align="right" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Tool calls</div>
            <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Number of tools that completed execution (Done type) in this session</div>
          </div>
        }>
          <span style={S.dim}>{s.done_count} tools</span>
        </Tip>
      </div>

      {/* Tool fingerprint — colored bar per tool (C.11) */}
      {s.top_tools.length > 0 && (
        <Tip position="top" align="left" content={
          <div>
            <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Most used tools</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {s.top_tools.map((tool, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: TOOL_COLORS[tool] ?? TOOL_COLORS.default, flexShrink: 0 }} />
                  <span style={{ color: '#c9d1d9', fontSize: 10 }}>{tool}</span>
                  {i === 0 && <span style={{ color: '#484f58', fontSize: 9 }}>— most frequent</span>}
                </div>
              ))}
            </div>
          </div>
        }>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {s.top_tools.slice(0, 12).map((tool, i) => (
              <span
                key={i}
                style={{
                  width: 12, height: 4, borderRadius: 2, flexShrink: 0,
                  background: TOOL_COLORS[tool] ?? TOOL_COLORS.default,
                  opacity: Math.max(0.2, 1 - i * 0.07),
                }}
              />
            ))}
            <span style={{ color: '#484f58', fontSize: 9, marginLeft: 5 }}>
              {s.top_tools[0]}{s.top_tools.length > 1 ? ` +${s.top_tools.length - 1}` : ''}
            </span>
          </div>
        </Tip>
      )}

      {/* Git branch */}
      {s.git_branch && (
        <div style={S.row}>
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#8b949e', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Git status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ color: '#c9d1d9', fontSize: 10 }}>Branch: <span style={{ fontFamily: 'monospace', color: '#79c0ff' }}>{s.git_branch}</span></div>
                {s.git_dirty && <div style={{ color: '#d29922', fontSize: 10 }}>* Local changes not committed</div>}
                {(s.git_ahead ?? 0) > 0 && <div style={{ color: '#58a6ff', fontSize: 10 }}>↑ {s.git_ahead} commit{(s.git_ahead ?? 0) !== 1 ? 's' : ''} ahead of remote</div>}
                {(s.git_behind ?? 0) > 0 && <div style={{ color: '#d29922', fontSize: 10 }}>↓ {s.git_behind} commit{(s.git_behind ?? 0) !== 1 ? 's' : ''} behind remote</div>}
                {!s.git_dirty && !(s.git_ahead ?? 0) && !(s.git_behind ?? 0) && (
                  <div style={{ color: '#3fb950', fontSize: 10 }}>Synced with remote</div>
                )}
              </div>
            </div>
          }>
            <span style={S.badge('#8b949e')}>
              <GitBranch size={9} />
              {s.git_branch}
              {s.git_dirty   ? <span style={{ color: '#d29922' }}>*</span>        : null}
              {(s.git_ahead  ?? 0) > 0 ? <span style={{ color: '#58a6ff' }}> ↑{s.git_ahead}</span>  : null}
              {(s.git_behind ?? 0) > 0 ? <span style={{ color: '#d29922' }}> ↓{s.git_behind}</span> : null}
            </span>
          </Tip>
        </div>
      )}

      {/* AI summary */}
      {s.ai_summary && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginTop: 2 }}>
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>AI Summary</div>
              <div style={{ color: '#7d8590', fontSize: 10, lineHeight: 1.5 }}>Automatically generated by the daemon when the session ends</div>
            </div>
          }>
            <Sparkles size={10} color="#7d8590" style={{ flexShrink: 0, marginTop: 1 }} />
          </Tip>
          <span style={{ color: '#9198a1', fontSize: 11, fontStyle: 'italic', lineHeight: 1.4 }}>{s.ai_summary}</span>
        </div>
      )}
    </div>
  )
}

export const SessionCard = memo(SessionCardInner)
