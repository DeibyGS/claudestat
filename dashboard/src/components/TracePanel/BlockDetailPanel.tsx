import { useState, useMemo } from 'react'
import {
  FileText, Loader2, CheckCircle2, ArrowDownLeft, ArrowUpRight,
  ChevronsUpDown, ChevronsDownUp,
} from 'lucide-react'
import type { BlockCost } from '../../types'
import type { TraceEvent } from '../../types'
import {
  extractActors, calcStats, getIntent, blockDuration, summaryText,
  matchesFilter, fmtUsd, fmtMs, fmtTokens, detail,
  TOOL_ICONS, TOOL_COLORS, FILTER_LABELS, fmtModelBlock,
  buildRenderItems,
} from './utils'
import type { Block, FilterType } from './utils'
import { ActorBadge, IntentBadge, ToolDistBar, SectionLabel, ToolRow, SkillContainer } from './BlockListItem'
import { DetailModal } from './DetailModal'

// ─── PromptScoreCard ──────────────────────────────────────────────────────────

type ScoreLevel = 'ok' | 'warn' | 'error'
interface PromptCheck { label: string; level: ScoreLevel; tip?: string }

export function scorePrompt(text: string): PromptCheck[] {
  const checks: PromptCheck[] = []

  // 1. Longitud
  if (text.length > 600) {
    checks.push({ label: `Too long · ${text.length} chars`, level: 'error',
      tip: 'Break into steps: send the main action first, then adjustments in separate messages.' })
  } else if (text.length > 300) {
    checks.push({ label: `Moderate · ${text.length} chars`, level: 'warn',
      tip: 'Consider splitting into two messages if you have more than one request.' })
  } else {
    checks.push({ label: `Concise · ${text.length} chars`, level: 'ok' })
  }

  // 2. Ambigüedad (frases vagas sin contexto)
  const vagueRe = /\b(arréglalo|arreglalo|fix it|make it work|mejóralo|mejoralo|improve it|make it better|algo así|somehow|whatever|haz que funcione|que funcione|que ande|hazlo funcionar|that it works|it's broken)\b/i
  if (vagueRe.test(text)) {
    checks.push({ label: 'Ambiguous', level: 'warn',
      tip: 'Describe the exact error or expected behavior. Example: "fails with TypeError on line 42" instead of "fix it".' })
  }

  // 3. Multi-tarea (demasiadas solicitudes en uno)
  const alsoCount  = (text.match(/\b(también|además|y también|and also|otra cosa|por otro lado|ademas)\b/gi) || []).length
  const bulletCount = (text.match(/^[-*•]\s/gm) || []).length + (text.match(/^\d+\.\s/gm) || []).length
  if (alsoCount >= 2 || bulletCount >= 4) {
    checks.push({ label: `Multi-task · ${alsoCount + bulletCount} indicators`, level: 'warn',
      tip: 'Too many requests at once. Claude prioritizes the first — send the rest in separate messages.' })
  }

  // 4. Especificidad (menciona rutas, funciones, errores → positivo)
  const hasPath  = /\/[\w\-./]+\.\w{2,4}/.test(text)
  const hasFunc  = /\b(function|función|método|method|class|clase|endpoint|route|ruta|hook|component|componente)\s+[\w]+/i.test(text)
  const hasError = /\b(Error|error|exception|Exception|undefined|null|Cannot|FAILED|TypeError|cannot read)\b/.test(text)
  const hasLine  = /\blínea\s+\d+|line\s+\d+|:\d+:\d+\b/.test(text)
  if (hasPath || hasFunc || hasError || hasLine) {
    checks.push({ label: 'Specific', level: 'ok' })
  } else if (text.length > 100) {
    checks.push({ label: 'Not specific enough', level: 'warn',
      tip: 'Include the file name, function, or exact error message for better results.' })
  }

  return checks
}

const SCORE_COLORS: Record<ScoreLevel, string> = { ok: '#3fb950', warn: '#d29922', error: '#f85149' }

function PromptScoreCard({ prompt }: { prompt: string }) {
  const [open,     setOpen]     = useState(false)
  const [expanded, setExpanded] = useState(false)
  const checks = scorePrompt(prompt)
  const worstLevel = checks.some(c => c.level === 'error') ? 'error'
    : checks.some(c => c.level === 'warn') ? 'warn' : 'ok'
  const recs = checks.filter(c => c.tip)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Prompt
          </span>
          {/* Score badges */}
          <div style={{ display: 'flex', gap: 4 }}>
            {checks.map((c, i) => (
              <span key={i} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                background: SCORE_COLORS[c.level] + '22',
                color: SCORE_COLORS[c.level],
                border: `1px solid ${SCORE_COLORS[c.level]}44`,
              }}>{c.label}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ background: 'none', border: `1px solid ${SCORE_COLORS[worstLevel]}44`, borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: SCORE_COLORS[worstLevel], fontSize: 10 }}
        >
          {open ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
          {open ? 'hide' : 'view'}
        </button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Prompt text */}
          <div style={{ position: 'relative' }}>
            <div style={{
              background: '#0d1117', border: '1px solid #21262d', borderRadius: 6,
              padding: '10px 12px 28px',
              maxHeight: expanded ? undefined : 120,
              overflow: expanded ? 'auto' : 'hidden',
              WebkitMaskImage: expanded ? undefined : 'linear-gradient(to bottom, black 55%, transparent 100%)',
            }}>
              <span style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {prompt}
              </span>
            </div>
            <button
              onClick={() => setExpanded(v => !v)}
              style={{
                position: 'absolute', bottom: 6, right: 8,
                background: '#21262d', border: '1px solid #30363d', borderRadius: 4,
                cursor: 'pointer', fontSize: 10, color: '#8b949e',
                padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {expanded ? <ChevronsDownUp size={9} /> : <ChevronsUpDown size={9} />}
              {expanded ? 'colapsar' : 'ver todo'}
            </button>
          </div>
          {/* Recommendations */}
          {recs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {recs.map((c, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, padding: '6px 10px',
                  background: SCORE_COLORS[c.level] + '0d',
                  border: `1px solid ${SCORE_COLORS[c.level]}33`,
                  borderLeft: `3px solid ${SCORE_COLORS[c.level]}`,
                  borderRadius: 5,
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: SCORE_COLORS[c.level], flexShrink: 0, marginTop: 1 }}>
                    {c.label.split('·')[0].trim().toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, color: '#7d8590', lineHeight: 1.5 }}>{c.tip}</span>
                </div>
              ))}
            </div>
          )}
          {recs.length === 0 && (
            <div style={{ fontSize: 10, color: '#3fb95099', paddingLeft: 4 }}>✓ Prompt bien estructurado</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── BlockDetailPanel ─────────────────────────────────────────────────────────

export function BlockDetailPanel({
  block, startedAt, blockCost, sessionModel, prompt,
}: {
  block:         Block
  startedAt:     number
  blockCost?:    BlockCost
  sessionModel?: string
  prompt?:       string
}) {
  const [filter,      setFilter]      = useState<FilterType>('all')
  const [selected,    setSelected]    = useState<TraceEvent | null>(null)
  const [logOpen,     setLogOpen]     = useState(true)
  const [durOpen,     setDurOpen]     = useState(false)
  const [filesOpen,   setFilesOpen]   = useState(true)
  const [bashOpen,    setBashOpen]    = useState(true)

  const actors    = extractActors(block.tools)
  const stats     = calcStats(block.tools)
  const intent    = getIntent(stats)
  const dur       = blockDuration(block)
  const totalCost = blockCost ? blockCost.inputUsd + blockCost.outputUsd : 0
  const inProg    = !block.hasStop

  // Duration timeline — only Done events with timing
  const timedTools = block.tools.filter(t => t.type === 'Done' && (t.duration_ms ?? 0) > 0)
  const maxDur     = Math.max(...timedTools.map(t => t.duration_ms ?? 0), 1)

  // Files touched (Read/Write/Edit only)
  const files = new Map<string, Set<string>>()
  for (const t of block.tools) {
    if (!t.tool_input || !t.tool_name) continue
    if (!['Read', 'Write', 'Edit'].includes(t.tool_name)) continue
    try {
      const inp  = JSON.parse(t.tool_input)
      const path = inp.file_path || inp.path
      if (path) {
        if (!files.has(path)) files.set(path, new Set())
        files.get(path)!.add(t.tool_name.toLowerCase())
      }
    } catch {}
  }

  // Bash commands (first 4)
  const bashCalls = block.tools
    .filter(t => t.tool_name === 'Bash' && t.tool_input)
    .slice(0, 4)
    .map(t => { try { return JSON.parse(t.tool_input!).command || '' } catch { return '' } })
    .filter(Boolean)

  // block.tools es inmutable por bloque — memoizar evita recomputo en cada render
  const { toolTypeCount, realLoopKeys, realLoopCount } = useMemo(() => {
    const toolTypeCount = new Map<string, number>()
    const exactCount    = new Map<string, number>()
    for (const t of block.tools) {
      if (!t.tool_name) continue
      toolTypeCount.set(t.tool_name, (toolTypeCount.get(t.tool_name) || 0) + 1)
      const key = `${t.tool_name}::${t.tool_input ?? ''}`
      exactCount.set(key, (exactCount.get(key) || 0) + 1)
    }
    const realLoopKeys = new Set<string>()
    for (const [k, n] of exactCount) {
      if (n >= 2) realLoopKeys.add(k)
    }
    return { toolTypeCount, realLoopKeys, realLoopCount: realLoopKeys.size }
  }, [block.tools])

  // Solo eventos con tool_name (excluye Cost/Human/etc.); in-progress = PreToolUse
  const renderItems  = useMemo(() => buildRenderItems(block.tools, filter), [block.tools, filter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', overflow: 'hidden' }}>

      {/* ── Block header ── */}
      <div style={{
        borderBottom: '1px solid #21262d',
        flexShrink: 0,
        background: '#0d1117',
        padding: '12px 48px 10px',
      }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {/* Row 1: meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ color: '#6e7681', fontSize: 12, fontWeight: 600 }}>Block #{block.index}</span>
            {actors.map((a, i) => <ActorBadge key={i} actor={a} />)}
            {intent && <IntentBadge intent={intent} />}
            <div style={{ flex: 1 }} />
            {dur && (
              <span style={{ color: '#6e7681', fontSize: 12, background: '#161b22', borderRadius: 4, padding: '2px 8px', border: '1px solid #21262d' }}>
                {dur}
              </span>
            )}
            {inProg
              ? <Loader2 size={14} style={{ color: '#d29922', animation: 'spin 1s linear infinite' }} />
              : <CheckCircle2 size={14} style={{ color: '#3fb950aa' }} />
            }
          </div>
          {/* Row 2: dist + summary */}
          {stats.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ToolDistBar stats={stats} />
              <span style={{ color: '#484f58', fontSize: 11 }}>{summaryText(stats)}</span>
              {realLoopCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#d29922', background: '#d2992215', border: '1px solid #d2992230', borderRadius: 4, padding: '1px 6px' }}>
                  {realLoopCount} repeated call{realLoopCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '20px 48px' }}>
      <div style={{ maxWidth: 840, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Prompt Score ── */}
        {prompt && block.hasStop && (
          <PromptScoreCard prompt={prompt} />
        )}

        {/* ── Duration Timeline ── */}
        {timedTools.length > 1 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: durOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Duration by tool ({timedTools.length})
              </div>
              <button
                onClick={() => setDurOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {durOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {durOpen ? 'hide' : 'show'}
              </button>
            </div>
            {durOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {timedTools.map((t, i) => {
                  const color = TOOL_COLORS[t.tool_name || ''] || TOOL_COLORS.default
                  const Icon  = TOOL_ICONS[t.tool_name || ''] || TOOL_ICONS.default
                  const pct   = ((t.duration_ms ?? 0) / maxDur) * 100
                  const det   = detail(t.tool_name, t.tool_input)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }}><Icon size={11} /></span>
                      <span style={{ color: '#6e7681', fontSize: 10, width: 52, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.tool_name}
                      </span>
                      {det && (
                        <span style={{ color: '#3d444d', fontSize: 10, width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {det}
                        </span>
                      )}
                      <div style={{ flex: 1, background: '#161b22', borderRadius: 2, height: 7, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: `linear-gradient(90deg, ${color}cc, ${color}55)`,
                          borderRadius: 2, transition: 'width 0.4s ease',
                        }} />
                      </div>
                      <span style={{ color: '#6e7681', fontSize: 10, minWidth: 40, textAlign: 'right', flexShrink: 0 }}>
                        {fmtMs(t.duration_ms)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Files touched ── */}
        {files.size > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: filesOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Files touched ({files.size})
              </div>
              <button
                onClick={() => setFilesOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {filesOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {filesOpen ? 'hide' : 'show'}
              </button>
            </div>
            {filesOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[...files.entries()].map(([path, ops]) => {
                  const hasWrite = ops.has('write') || ops.has('edit')
                  const short    = path.split('/').slice(-3).join('/')
                  return (
                    <div key={path} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '4px 10px', borderRadius: 5,
                      background: hasWrite ? '#0e1f12' : '#0d1117',
                      border: `1px solid ${hasWrite ? '#3fb95022' : '#1e2329'}`,
                    }}>
                      <FileText size={11} style={{ color: hasWrite ? '#3fb950' : '#58a6ff', flexShrink: 0 }} />
                      <span style={{ color: '#8b949e', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
                        {short}
                      </span>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {[...ops].map(op => (
                          <span key={op} style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                            color: op === 'read' ? '#58a6ff' : '#3fb950',
                            background: (op === 'read' ? '#58a6ff' : '#3fb950') + '18',
                            borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase',
                          }}>{op}</span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Bash commands ── */}
        {bashCalls.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bashOpen ? 8 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#484f58', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Commands ({bashCalls.length})
              </div>
              <button
                onClick={() => setBashOpen(v => !v)}
                style={{ background: 'none', border: '1px solid #21262d', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', color: '#6e7681', fontSize: 10 }}
              >
                {bashOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {bashOpen ? 'hide' : 'show'}
              </button>
            </div>
            {bashOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bashCalls.map((cmd, i) => (
                  <div key={i} style={{
                    background: '#0d1117', border: '1px solid #21262d',
                    borderRadius: 5, padding: '5px 10px',
                    fontFamily: 'monospace', fontSize: 11, color: '#d29922',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={cmd}>
                    $ {cmd}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Cost breakdown ── */}
        {blockCost && totalCost > 0 && (
          <div>
            <SectionLabel>Costo</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#0c1520', border: '1px solid #58a6ff22', borderRadius: 7, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <ArrowDownLeft size={10} /> Input
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#58a6ff' }}>{fmtUsd(blockCost.inputUsd)}</div>
                {blockCost.inputTokens > 0 && (
                  <div style={{ fontSize: 10, color: '#58a6ff88', marginTop: 3 }}>
                    {fmtTokens(blockCost.inputTokens)}
                  </div>
                )}
              </div>
              <div style={{ background: '#0a1a0f', border: '1px solid #3fb95022', borderRadius: 7, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#3fb950', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <ArrowUpRight size={10} /> Output
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#3fb950' }}>{fmtUsd(blockCost.outputUsd)}</div>
                {blockCost.outputTokens > 0 && (
                  <div style={{ fontSize: 10, color: '#3fb95088', marginTop: 3 }}>
                    {fmtTokens(blockCost.outputTokens)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modelo real de la sesión + sub-agentes ── */}
        {sessionModel && (() => {
          const m = fmtModelBlock(sessionModel)
          // Detectar modelos de sub-agentes lanzados en este bloque
          const subModels: string[] = [...new Set(
            block.tools
              .filter(t => t.tool_name === 'Agent' && t.tool_input)
              .flatMap(t => {
                try { const inp = JSON.parse(t.tool_input!); return inp.model ? [inp.model as string] : [] }
                catch { return [] }
              })
              .filter(sm => !sessionModel.includes(sm) && sm !== sessionModel)
          )]
          return (
            <div>
              <SectionLabel>Model</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {/* Modelo principal */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: m.color + '12', border: `1px solid ${m.color}25`,
                  borderRadius: 6, padding: '4px 10px',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span style={{ color: m.color, fontSize: 11, fontWeight: 700 }}>{m.name}</span>
                </div>
                {/* Sub-agentes con modelo diferente */}
                {subModels.map(sm => {
                  const s = fmtModelBlock(sm)
                  return (
                    <div key={sm} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: s.color + '12', border: `1px solid ${s.color}25`,
                      borderRadius: 6, padding: '4px 10px',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                      <span style={{ color: s.color, fontSize: 11, fontWeight: 700 }}>{s.name}</span>
                      <span style={{ color: s.color + '99', fontSize: 9, fontWeight: 500 }}>sub-agente</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* ── Tool log ── */}
        {block.tools.length > 0 && (
          <div>
            {/* Tool log header with filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <SectionLabel>Tool calls ({block.tools.length})</SectionLabel>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setLogOpen(v => !v)}
                style={{
                  background: 'none', border: '1px solid #21262d', borderRadius: 4,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '1px 7px', color: '#6e7681', fontSize: 10,
                }}
              >
                {logOpen ? <ChevronsDownUp size={10} /> : <ChevronsUpDown size={10} />}
                {logOpen ? 'hide' : 'show'}
              </button>
            </div>

            {logOpen && (
              <>
                {/* Inline filter */}
                <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                  {FILTER_LABELS.map(({ id, label, icon: Icon, color }) => {
                    const active = filter === id
                    return (
                      <button key={id} onClick={() => setFilter(id)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', borderRadius: 4,
                        fontSize: 10, fontWeight: active ? 600 : 400,
                        color: active ? color : '#6e7681',
                        background: active ? color + '18' : 'transparent',
                        border: active ? `1px solid ${color}40` : '1px solid transparent',
                        cursor: 'pointer',
                      }}>
                        <Icon size={9} />{label}
                      </button>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {renderItems.map((item, i) =>
                    item.kind === 'skillGroup' ? (
                      <SkillContainer
                        key={i}
                        skillEv={item.skillEv}
                        children={item.children}
                        startedAt={startedAt}
                        toolTypeCount={toolTypeCount}
                        realLoopKeys={realLoopKeys}
                        blockDone={block.hasStop}
                        onToolClick={setSelected}
                      />
                    ) : (
                      <ToolRow
                        key={i} ev={item.ev} startedAt={startedAt}
                        typeCount={toolTypeCount.get(item.ev.tool_name || '') || 0}
                        isRealLoop={realLoopKeys.has(`${item.ev.tool_name}::${item.ev.tool_input ?? ''}`)}
                        blockDone={block.hasStop}
                        onClick={() => setSelected(item.ev)}
                      />
                    )
                  )}
                  {renderItems.length === 0 && (
                    <div style={{ color: '#484f58', fontSize: 11, paddingLeft: 8 }}>sin resultados</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>
      </div>
      </div>

      {selected && <DetailModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
