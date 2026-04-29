import { Loader2, CheckCircle2, MessageSquare, Bot, Zap, TriangleAlert } from 'lucide-react'
import type { BlockCost } from '../../types'
import { Tip } from '../Tip'
import {
  fmtUsd, fmtTok, extractActors, calcStats, getIntent, blockDuration,
  CAT_COLORS, TOOL_ICONS, TOOL_COLORS, FILTER_LABELS, checkDangerous,
  relTs, detail, getSkillName, fmtModelBlock,
} from './utils'
import type { Block, Actor, ToolStats, Cat, FilterType } from './utils'
import { useState } from 'react'

// ─── ActorBadge ───────────────────────────────────────────────────────────────

export function ActorBadge({ actor }: { actor: Actor }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      color: actor.color, background: actor.color + '15', border: `1px solid ${actor.color}30`,
    }}>
      {actor.type === 'agent' && <Bot size={9} />}
      {actor.type === 'skill' && <Zap size={9} />}
      {actor.label}
    </span>
  )
}

// ─── IntentBadge ──────────────────────────────────────────────────────────────

export function IntentBadge({ intent }: { intent: { label: string; color: string } }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      color: intent.color, background: intent.color + '15',
      border: `1px solid ${intent.color}30`,
      borderRadius: 4, padding: '1px 6px', flexShrink: 0,
    }}>
      {intent.label}
    </span>
  )
}

// ─── ToolDistBar ──────────────────────────────────────────────────────────────

export function ToolDistBar({ stats }: { stats: ToolStats }) {
  if (stats.total === 0) return null
  const cats: [Cat, number][] = [
    ['read', stats.read], ['write', stats.write], ['bash', stats.bash],
    ['agent', stats.agent], ['web', stats.web], ['other', stats.other],
  ]
  return (
    <div style={{
      display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden',
      width: 48, flexShrink: 0, background: '#1a1f26',
    }}>
      {cats.filter(([, n]) => n > 0).map(([cat, n]) => (
        <div key={cat} title={`${cat}: ${n}`}
          style={{ width: `${(n / stats.total) * 100}%`, background: CAT_COLORS[cat] }} />
      ))}
    </div>
  )
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  )
}

// ─── Block color helper ───────────────────────────────────────────────────────

// Prioridad: selected > inProgress > heatRole > default
function getBlockColors(isSelected: boolean, inProgress: boolean, heatRole?: 'max' | 'min') {
  if (isSelected)         return { border: '#58a6ff40', borderLeft: '#58a6ff', bg: '#161d2d', bgHover: '#161d2d', cost: '#79c0ff' }
  if (inProgress)         return { border: '#d2992240', borderLeft: '#d29922', bg: '#1c1a14', bgHover: '#1c1a14', cost: '#d29922' }
  if (heatRole === 'max') return { border: '#f8514928', borderLeft: '#f85149', bg: '#160e0e', bgHover: '#1e0f0f', cost: '#f85149' }
  if (heatRole === 'min') return { border: '#3fb95028', borderLeft: '#3fb950', bg: '#0d160e', bgHover: '#0f1e10', cost: '#3fb950' }
  return                         { border: '#1e2329',   borderLeft: '#30363d', bg: '#111519', bgHover: '#161b22', cost: '#6e7681' }
}

// ─── BlockListItem ────────────────────────────────────────────────────────────

export function BlockListItem({
  block, blockCost, isLast, isSelected, heatRole, onClick,
}: {
  block:      Block
  blockCost?: BlockCost
  isLast:     boolean
  isSelected: boolean
  heatRole?:  'max' | 'min'
  onClick:    () => void
}) {
  const inProgress = !block.hasStop && isLast
  const actors     = extractActors(block.tools)
  const stats      = calcStats(block.tools)
  const intent     = getIntent(stats)
  const dur        = blockDuration(block)
  const totalCost = blockCost ? blockCost.inputUsd + blockCost.outputUsd : 0
  const clr       = getBlockColors(isSelected, inProgress, heatRole)

  return (
    <div
      onClick={onClick}
      style={{
        margin: '4px 8px',
        borderRadius: 7,
        border: `1px solid ${clr.border}`,
        borderLeft: `3px solid ${clr.borderLeft}`,
        background: clr.bg,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        animation: inProgress ? 'borderPulse 2s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = clr.bgHover }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = clr.bg }}
    >
      {/* Row 1: index + actors + cost + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <span style={{ color: '#484f58', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>#{block.index}</span>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {actors.slice(0, 1).map((a, i) => <ActorBadge key={i} actor={a} />)}
          {actors.length > 1 && <span style={{ fontSize: 9, color: '#6e7681' }}>+{actors.length - 1}</span>}
        </div>
        {totalCost > 0 && (
          <span style={{ color: clr.cost, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
            {fmtUsd(totalCost)}
          </span>
        )}
        {inProgress
          ? <Loader2 size={11} style={{ color: '#d29922', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : block.hasStop && <CheckCircle2 size={11} style={{ color: '#3fb95066', flexShrink: 0 }} />
        }
      </div>
      {/* Row 2: dist bar + intent + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {block.tools.length === 0
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: '#79c0ff', background: '#79c0ff15',
                border: '1px solid #79c0ff30',
                borderRadius: 4, padding: '1px 6px',
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <MessageSquare size={9} />
                text response
              </span>
              {blockCost?.outputTokens ? <span style={{ color: '#484f58', fontSize: 10 }}>· {fmtTok(blockCost.outputTokens)} out</span> : null}
            </span>
          : <>
              <ToolDistBar stats={stats} />
              {intent && <IntentBadge intent={intent} />}
            </>
        }
        <div style={{ flex: 1 }} />
        {blockCost && (blockCost.inputTokens + blockCost.outputTokens) > 0 && (
          <span style={{ color: '#484f58', fontSize: 10, flexShrink: 0 }}>
            {fmtTok(blockCost.inputTokens + blockCost.outputTokens)}
          </span>
        )}
        {dur && <span style={{ color: '#3d444d', fontSize: 10, flexShrink: 0, marginLeft: 4 }}>· {dur}</span>}
      </div>
    </div>
  )
}

// ─── ToolRow ──────────────────────────────────────────────────────────────────

export function ToolRow({
  ev, startedAt, typeCount, isRealLoop, onClick, blockDone,
}: {
  ev:          import('../../types').TraceEvent
  startedAt:   number
  typeCount:   number   // veces que aparece este tipo de tool en el bloque (diversas entradas)
  isRealLoop:  boolean  // mismo tool + misma entrada repetida ≥2 veces
  onClick:     () => void
  blockDone:   boolean  // true = bloque completo (tiene Stop) → click habilitado
}) {
  const done      = ev.type === 'Done'
  // Solo permite abrir el modal si la herramienta terminó Y el bloque está completo
  const clickable = done && blockDone
  const Icon  = TOOL_ICONS[ev.tool_name || ''] || TOOL_ICONS.default
  const color = done ? (TOOL_COLORS[ev.tool_name || ''] || TOOL_COLORS.default) : '#6e7681'
  const det   = detail(ev.tool_name, ev.tool_input)

  return (
    <div
      onClick={clickable ? onClick : undefined}
      title={!done ? 'In progress…' : !blockDone ? 'Available when block completes' : 'Click to see input/output'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px 4px 16px',
        borderLeft: `2px solid ${done ? color + '50' : '#21262d'}`,
        marginLeft: 8,
        opacity: done ? (blockDone ? 1 : 0.5) : 0.6,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: '0 4px 4px 0',
      }}
      onMouseEnter={e => done && (e.currentTarget.style.background = '#161b22')}
      onMouseLeave={e => done && (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: '#484f58', fontSize: 10, minWidth: 48, fontFamily: 'monospace' }}>
        {relTs(startedAt, ev.ts)}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', color, flexShrink: 0 }}><Icon size={12} /></span>
      <span style={{ color: done ? '#c9d1d9' : '#8b949e', fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
        {ev.tool_name || ev.type}
      </span>
      {det && (
        <span style={{ color: '#484f58', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {det}
        </span>
      )}
      {!det && <span style={{ flex: 1 }} />}
      {isRealLoop && (
        <Tip position="top" align="right" content={
          <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: '#d29922', fontWeight: 700 }}>Repeated call</span><br />
            <span style={{ color: '#e6edf3' }}>{ev.tool_name}</span> was called with<br />
            exactly the same input ≥2 times —<br />
            possible loop without real progress
          </div>
        }>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#d29922', fontSize: 10, fontWeight: 700, background: '#d2992218', borderRadius: 3, padding: '1px 5px', flexShrink: 0, cursor: 'help' }}>
            <TriangleAlert size={9} /> repeated
          </span>
        </Tip>
      )}
      {!isRealLoop && typeCount >= 3 && (
        <Tip position="top" align="right" content={
          <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
            <span style={{ color: '#e6edf3', fontWeight: 700 }}>{ev.tool_name}</span> was called <span style={{ color: '#e6edf3' }}>{typeCount} times</span> in this block<br />
            with different inputs — normal intensive use, not a loop
          </div>
        }>
          <span style={{ color: '#484f58', fontSize: 10, fontVariantNumeric: 'tabular-nums', flexShrink: 0, cursor: 'help' }}>
            ×{typeCount}
          </span>
        </Tip>
      )}
      {checkDangerous(ev.tool_name, ev.tool_input) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ff7b72', fontSize: 10, fontWeight: 700, background: '#f8514920', border: '1px solid #f8514940', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
          <TriangleAlert size={9} /> dangerous
        </span>
      )}
      {/* Badge de modelo para llamadas Agent */}
      {done && ev.tool_name === 'Agent' && (() => {
        try {
          const inp = JSON.parse(ev.tool_input || '{}')
          const model = inp.model as string | undefined
          if (model) {
            const s = fmtModelBlock(model)
            return (
              <span style={{ color: s.color, fontSize: 9, fontWeight: 700, background: s.color + '18', border: `1px solid ${s.color}30`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                {s.name}
              </span>
            )
          }
        } catch {}
        return null
      })()}
      {!done
        ? <Loader2 size={10} style={{ color: '#6e7681', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        : <CheckCircle2 size={10} style={{ color: color + 'aa', flexShrink: 0 }} />
      }
    </div>
  )
}

// ─── SkillContainer ───────────────────────────────────────────────────────────

export function SkillContainer({
  skillEv, children, startedAt, toolTypeCount, realLoopKeys, blockDone, onToolClick,
}: {
  skillEv:      import('../../types').TraceEvent
  children:     import('../../types').TraceEvent[]
  startedAt:    number
  toolTypeCount: Map<string, number>
  realLoopKeys: Set<string>
  blockDone:    boolean
  onToolClick:  (ev: import('../../types').TraceEvent) => void
}) {
  const [open, setOpen] = useState(true)
  const name = getSkillName(skillEv)
  return (
    <div style={{ marginLeft: 8, borderLeft: '2px solid #58a6ff30', borderRadius: '0 4px 4px 0', marginBottom: 2 }}>
      {/* Skill header row */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 12px 4px 16px', cursor: 'pointer',
          borderRadius: '0 4px 4px 0',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#161b22')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ color: '#484f58', fontSize: 10, minWidth: 48, fontFamily: 'monospace' }}>
          {relTs(startedAt, skillEv.ts)}
        </span>
        <Zap size={12} color="#58a6ff" />
        <span style={{ color: '#c9d1d9', fontWeight: 600, fontSize: 11, flex: 1 }}>/{name}</span>
        <span style={{ fontSize: 9, color: '#58a6ff88', background: '#58a6ff12', border: '1px solid #58a6ff25', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
          {children.length} sub-calls
        </span>
        <span style={{ color: '#484f58' }}>
          {open
            ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
            : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          }
        </span>
        <CheckCircle2 size={10} style={{ color: '#58a6ffaa', flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{ paddingLeft: 8, borderLeft: '1px solid #21262d', marginLeft: 8 }}>
          {children.map((ev, i) => (
            <ToolRow
              key={i} ev={ev} startedAt={startedAt}
              typeCount={toolTypeCount.get(ev.tool_name || '') || 0}
              isRealLoop={realLoopKeys.has(`${ev.tool_name}::${ev.tool_input ?? ''}`)}
              blockDone={blockDone}
              onClick={() => onToolClick(ev)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
