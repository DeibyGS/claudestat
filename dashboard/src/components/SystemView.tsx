import { useState } from 'react'
import { GitBranch, Cpu, BrainCircuit, FileText, Zap, Settings2, ChevronDown, ChevronRight,
         CheckCircle2, XCircle, Bot, Layers, Workflow, MemoryStick } from 'lucide-react'
import { Tip } from './Tip'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SystemConfig {
  hooks:             Record<string, { matcher?: string; command: string }[]>
  agents:            { name: string; description: string }[]
  workflows:         { name: string; description: string; lines: number }[]
  skills:            { name: string; description: string; lines: number }[]
  contextFiles:      { key: string; exists: boolean; sizeKb: number; lines: number }[]
  memoryFiles:       string[]
  modeDistribution:  { direct: number; mini: number; pipeline: number; total: number }
  claudestatConfig: {
    killSwitchEnabled?:  boolean
    killSwitchThreshold?: number
    warnThresholds?:     number[]   // [yellow, orange, red]
    plan?:               string | null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

// Hooks suelen ser rutas largas — mostramos solo el script final
function hookCommand(cmd?: string): string {
  if (!cmd) return ''
  const match = cmd.match(/(?:node|python3?|bash|sh|deno|bun)\s+[~\w/.]+\/([\w.-]+)/)
  return match ? `…/${match[1]}` : cmd.slice(0, 50)
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d',
      borderRadius: 8, padding: '14px 16px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionHeader({
  icon: Icon, title, subtitle, color = '#58a6ff', open, onToggle, badge,
}: {
  icon: React.ElementType; title: string; subtitle?: string; color?: string
  open: boolean; onToggle: () => void; badge?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: open ? 12 : 0,
      }}
    >
      <Icon size={13} color={color} />
      <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700, flex: 1, textAlign: 'left' }}>{title}</span>
      {subtitle && <span style={{ fontSize: 10, color: '#484f58' }}>{subtitle}</span>}
      {badge}
      {open
        ? <ChevronDown size={12} color="#484f58" />
        : <ChevronRight size={12} color="#484f58" />
      }
    </button>
  )
}

/** Línea de árbol con conector visual */
function TreeRow({ label, value, last = false, color = '#8b949e', tip }: {
  label: string; value?: React.ReactNode; last?: boolean; color?: string; tip?: string
}) {
  const row = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingLeft: 16, position: 'relative' }}>
      {/* Conector de árbol */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: last ? '50%' : 0,
        width: 1, background: '#21262d',
      }} />
      <div style={{
        position: 'absolute', left: 0, top: '50%',
        width: 10, height: 1, background: '#21262d',
      }} />
      <span style={{ fontSize: 11, color, fontWeight: 500 }}>{label}</span>
      {value !== undefined && (
        <span style={{ fontSize: 10, color: '#484f58', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
      )}
    </div>
  )
  if (!tip) return row
  return (
    <Tip position="top" align="left" content={
      <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>{tip}</div>
    }>{row}</Tip>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: color + '18', border: `1px solid ${color}35`,
      borderRadius: 4, padding: '1px 6px',
    }}>{text}</span>
  )
}

// ─── Sección: Hooks ───────────────────────────────────────────────────────────

const HOOK_META: Record<string, { label: string; tip: string }> = {
  SessionStart: { label: 'SessionStart', tip: 'Runs when each Claude Code session starts. Loads Engram context and the project HANDOFF.' },
  PreToolUse:   { label: 'PreToolUse',   tip: 'Runs before each tool call. claudestat uses it to check the kill-switch and record the event start.' },
  PostToolUse:  { label: 'PostToolUse',  tip: 'Runs after each tool call with the result. claudestat sends the event to the daemon to enrich it with cost and duration.' },
  Stop:         { label: 'Stop',         tip: 'Runs when Claude finishes responding. claudestat records the full block and emits the stop event for SSE.' },
}

function HooksSection({ hooks }: { hooks: Record<string, { matcher?: string; command: string }[]> }) {
  const [open, setOpen] = useState(true)
  const hookNames = Object.keys(hooks)
  const active    = hookNames.length

  return (
    <Card>
      <SectionHeader
        icon={Zap} title="Active hooks" color="#d29922"
        subtitle={active > 0 ? undefined : 'none configured'}
        badge={active > 0 ? <Badge text={`${active} hooks`} color="#d29922" /> : undefined}
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {active === 0 ? (
            <span style={{ fontSize: 11, color: '#484f58' }}>
              No hooks in ~/.claude/settings.json — claudestat is not active
            </span>
          ) : hookNames.map((name, i) => {
            const entries = hooks[name]
            const meta    = HOOK_META[name]
            return (
              <Tip key={name} position="bottom" align="left" content={
                <div>
                  <div style={{ color: '#d29922', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{meta?.label ?? name}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>{meta?.tip ?? ''}</div>
                  {entries.map((e, j) => (
                    <div key={j} style={{ color: '#3d444d', fontFamily: 'monospace', fontSize: 9, marginTop: 4 }}>
                      {hookCommand(e.command)}
                    </div>
                  ))}
                </div>
              }>
                <TreeRow
                  label={meta?.label ?? name}
                  value={<span style={{ fontFamily: 'monospace', color: '#3d444d' }}>{hookCommand(entries[0]?.command ?? '')}</span>}
                  last={i === hookNames.length - 1}
                  color="#d29922"
                />
              </Tip>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Agentes ─────────────────────────────────────────────────────────

function AgentsSection({ agents }: { agents: { name: string; description: string }[] }) {
  const [open, setOpen] = useState(true)

  return (
    <Card>
      <SectionHeader
        icon={Bot} title="Available agents" color="#bc8cff"
        subtitle="~/.claude/agents/"
        badge={agents.length > 0 ? <Badge text={`${agents.length}`} color="#bc8cff" /> : undefined}
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {agents.length === 0 ? (
            <span style={{ fontSize: 11, color: '#484f58' }}>No agents in ~/.claude/agents/</span>
          ) : agents.map((a, i) => (
            <Tip key={a.name} position="top" align="left" content={
              <div>
                <div style={{ color: '#bc8cff', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{a.name}</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                  {a.description || 'No description in the .md file frontmatter'}
                </div>
              </div>
            }>
              <TreeRow
                label={a.name} last={i === agents.length - 1} color="#bc8cff"
                value={a.description
                  ? <span style={{ color: '#3d444d', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>{a.description.slice(0, 40)}{a.description.length > 40 ? '…' : ''}</span>
                  : undefined
                }
              />
            </Tip>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Skills ──────────────────────────────────────────────────────────

const SKILL_LINE_LIMIT = 500  // límite oficial Anthropic para SKILL.md

function SkillsSection({ skills }: { skills: { name: string; description: string; lines: number }[] }) {
  const [open, setOpen] = useState(true)
  const overLimit = skills.filter(s => s.lines >= SKILL_LINE_LIMIT * 0.9).length

  return (
    <Card>
      <SectionHeader
        icon={Zap} title="Available skills" color="#3fb950"
        subtitle="~/.claude/commands/"
        badge={skills.length > 0
          ? <Badge text={`${skills.length}${overLimit > 0 ? ` · ${overLimit} ⚠` : ''}`} color={overLimit > 0 ? '#d29922' : '#3fb950'} />
          : undefined
        }
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {skills.length === 0 ? (
            <span style={{ fontSize: 11, color: '#484f58' }}>No skills in ~/.claude/commands/</span>
          ) : skills.map((s, i) => {
            const skillPct  = s.lines / SKILL_LINE_LIMIT
            const lineColor = pctToColor(skillPct)
            const hasLimit  = skillPct >= 0.7
            return (
              <Tip key={s.name} position="top" align="left" content={
                <div>
                  <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>/{s.name}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                    {s.description || 'No description in the .md file frontmatter'}
                  </div>
                  <div style={{ color: lineColor, fontSize: 9, marginTop: 4 }}>
                    {s.lines} lines {hasLimit ? `— recommended limit: ${SKILL_LINE_LIMIT}` : `/ ${SKILL_LINE_LIMIT} recommended`}
                  </div>
                </div>
              }>
                <TreeRow
                  label={`/${s.name}`}
                  last={i === skills.length - 1}
                  color="#3fb950"
                  value={
                    <span style={{ color: lineColor, fontVariantNumeric: 'tabular-nums' }}>
                      {s.lines} ln {hasLimit ? '⚠' : ''}
                    </span>
                  }
                />
              </Tip>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Memoria ─────────────────────────────────────────────────────────

function MemorySection({ memoryFiles }: { memoryFiles: string[] }) {
  const [open, setOpen] = useState(true)
  const engramOk = memoryFiles.length > 0

  return (
    <Card>
      <SectionHeader
        icon={MemoryStick} title="Memory system" color="#58a6ff"
        badge={engramOk ? <Badge text={`${memoryFiles.length} files`} color="#58a6ff" /> : undefined}
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {!engramOk ? (
            <span style={{ fontSize: 11, color: '#484f58' }}>
              Engram not detected. Optional MCP plugin for persistent memory between sessions.
            </span>
          ) : memoryFiles.map((f, i) => (
            <TreeRow
              key={f}
              label={f}
              last={i === memoryFiles.length - 1}
              color={f === 'MEMORY.md' ? '#79c0ff' : '#58a6ff'}
              tip={f === 'MEMORY.md' ? 'Auto-loaded index — every session reads this file automatically.' : `Memory file: ~/.claude/projects/…/memory/${f}`}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Workflows ───────────────────────────────────────────────────────

function WorkflowsSection({ workflows }: { workflows: { name: string; description: string; lines: number }[] }) {
  const [open, setOpen] = useState(true)

  return (
    <Card>
      <SectionHeader
        icon={Workflow} title="Workflows / pipelines" color="#56d364"
        subtitle="~/.claude/agents/workflows/"
        badge={workflows.length > 0 ? <Badge text={`${workflows.length}`} color="#56d364" /> : undefined}
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {workflows.length === 0 ? (
            <span style={{ fontSize: 11, color: '#484f58' }}>No workflows in ~/.claude/agents/workflows/</span>
          ) : workflows.map((w, i) => (
            <Tip key={w.name} position="top" align="left" content={
              <div>
                <div style={{ color: '#56d364', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{w.name}</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                  {w.description || 'No description in the .md file frontmatter'}
                </div>
              </div>
            }>
              <TreeRow
                label={w.name} last={i === workflows.length - 1} color="#56d364"
                value={w.description
                  ? <span style={{ color: '#3d444d' }}>{w.description.slice(0, 40)}{w.description.length > 40 ? '…' : ''}</span>
                  : undefined
                }
              />
            </Tip>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Archivos de contexto ───────────────────────────────────────────

const CONTEXT_FILE_TIPS: Record<string, string> = {
  'CLAUDE.md global':   'Permanent instructions for Claude: profile, response style, code rules and project protocol. Loaded every session.',
  'MEMORY.md':          'Engram auto-memory index. Auto-loaded into every session via system prompt. Keep under 200 lines — content after line 200 is truncated.',
  'settings.json':      'Claude Code configuration: installed hooks, permissions, default model. claudestat needs the hooks here to work.',
  'config claudestat': 'Active claudestat configuration: plan, kill switch and quota thresholds. Read on every PreToolUse hook evaluation.',
}

// Límites oficiales de Anthropic (docs.anthropic.com/claude-code)
// CLAUDE.md se carga completo → 200 líneas recomendadas
const CONTEXT_FILE_LIMITS: Record<string, { lines?: number; kb?: number }> = {
  'CLAUDE.md global': { lines: 200 },
  'MEMORY.md':        { lines: 200 },
}

// Verde/amarillo/rojo según % de utilización respecto a un límite
function pctToColor(pct: number): string {
  if (pct >= 0.9) return '#f85149'
  if (pct >= 0.7) return '#d29922'
  return '#3fb950'
}

function fileLimitColor(lines: number, sizeKb: number, key: string): string | null {
  const limit = CONTEXT_FILE_LIMITS[key]
  if (!limit) return null
  const linePct = limit.lines ? lines / limit.lines : 0
  const kbPct   = limit.kb   ? sizeKb / limit.kb   : 0
  return pctToColor(Math.max(linePct, kbPct))
}

function ContextFileValue({ f }: { f: { key: string; exists: boolean; sizeKb: number; lines: number } }) {
  if (!f.exists) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#f85149' }}>
      <XCircle size={9} /> not found
    </span>
  )
  const alertColor = fileLimitColor(f.lines, f.sizeKb, f.key)
  const color      = alertColor ?? '#3fb950'
  const limit      = CONTEXT_FILE_LIMITS[f.key]
  const label      = limit?.lines
    ? `${f.lines} ln / ${limit.lines}`
    : f.sizeKb > 0 ? `${f.sizeKb} KB` : '< 1 KB'
  return <span style={{ color }}>{label} {alertColor ? '⚠' : '✓'}</span>
}

function ContextSection({ files }: { files: { key: string; exists: boolean; sizeKb: number; lines: number }[] }) {
  const [open, setOpen] = useState(true)
  const present = files.filter(f => f.exists).length

  return (
    <Card>
      <SectionHeader
        icon={FileText} title="Context files" color="#3fb950"
        badge={<Badge text={`${present}/${files.length}`} color="#3fb950" />}
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {files.map((f, i) => (
            <Tip key={f.key} position="top" align="left" content={
              <div>
                <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{f.key}</div>
                <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                  {CONTEXT_FILE_TIPS[f.key] ?? 'System configuration file.'}
                </div>
              </div>
            }>
              <TreeRow
                label={f.key}
                last={i === files.length - 1}
                color={f.exists ? '#e6edf3' : '#484f58'}
                value={<ContextFileValue f={f} />}
              />
            </Tip>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: Modos de trabajo ────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', max5: 'Max 5×', max20: 'Max 20×' }

const MODES = [
  {
    key: 'direct' as const,
    label: 'Claude direct',
    when: '≤ 2 files, no new endpoints',
    color: '#3fb950',
    tip: 'Claude works alone. Ideal for small changes: CSS, text, simple bugs. No agents or pipeline.',
  },
  {
    key: 'mini' as const,
    label: 'Mini-pipeline',
    when: '3–5 files or 1–2 new endpoints',
    color: '#58a6ff',
    tip: '3 agents: implementer → quality-docs → tester. Git is not automatic — invoke with /git when the user decides.',
  },
  {
    key: 'pipeline' as const,
    label: 'Full pipeline',
    when: '≥ 6 files or new feature',
    color: '#d29922',
    tip: 'Full agent team. Scrum master, backend, frontend, quality-docs, tester. Git separate — invoke /git when you decide. For large features.',
  },
]

function ModesSection({ dist }: { dist: SystemConfig['modeDistribution'] }) {
  const [open, setOpen] = useState(true)
  const mostUsed = dist.total > 0
    ? MODES.reduce((best, m) => dist[m.key] > dist[best.key] ? m : best, MODES[0])
    : null

  return (
    <Card>
      <SectionHeader
        icon={Workflow} title="Work modes" color="#f0883e"
        subtitle="last 7 days"
        badge={mostUsed && dist.total > 0
          ? <Badge text={`most used: ${mostUsed.label}`} color={mostUsed.color} />
          : undefined
        }
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODES.map(mode => {
            const n   = dist[mode.key]
            const p   = pct(n, dist.total)
            return (
              <Tip key={mode.key} position="top" align="left" content={
                <div>
                  <div style={{ color: mode.color, fontWeight: 700, fontSize: 11, marginBottom: 3 }}>{mode.label}</div>
                  <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                    <span style={{ color: '#6e7681' }}>When: </span>{mode.when}<br />
                    {mode.tip}
                  </div>
                </div>
              }>
                <div style={{ cursor: 'help' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: mode.color, fontWeight: 600, width: 130, flexShrink: 0 }}>{mode.label}</span>
                    <span style={{ fontSize: 10, color: '#484f58', flex: 1 }}>{mode.when}</span>
                    <span style={{ fontSize: 11, color: '#e6edf3', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {dist.total > 0 ? `${n} (${p}%)` : '—'}
                    </span>
                  </div>
                  <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${p}%`, height: '100%', background: mode.color, borderRadius: 2, transition: 'width 0.5s' }} />
                  </div>
                </div>
              </Tip>
            )
          })}
          {dist.total === 0 && (
            <span style={{ fontSize: 11, color: '#484f58' }}>No sessions recorded in the last 7 days</span>
          )}
          {dist.total > 0 && (
            <div style={{ fontSize: 9, color: '#3d444d', marginTop: 2 }}>
              {dist.total} sessions analyzed · Mode inferred by number of Agent tool calls per session
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Sección: claudestat config ─────────────────────────────────────────────

function ClaudestatSection({ cfg }: { cfg: SystemConfig['claudestatConfig'] }) {
  const [open, setOpen] = useState(true)
  const plan = cfg.plan ?? 'pro'
  const ks   = cfg.killSwitchEnabled ?? true
  const [warnYellow, warnOrange, warnRed] = cfg.warnThresholds ?? [70, 85, 95]

  return (
    <Card>
      <SectionHeader
        icon={Settings2} title="claudestat config" color="#8b949e"
        subtitle="~/.claudestat/config.json"
        open={open} onToggle={() => setOpen(v => !v)}
      />
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <TreeRow
            label="Plan"
            value={<Badge text={PLAN_LABEL[plan] ?? plan} color="#58a6ff" />}
            tip="Claude Max plan that determines weekly hour limits per model."
          />
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: ks ? '#3fb950' : '#f85149', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>
                Kill switch {ks ? 'enabled' : 'disabled'}
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                When ON, blocks new tool calls if the 5h quota exceeds the red threshold.<br />
                Configure with: <code style={{ color: '#d29922' }}>claudestat config</code>
              </div>
            </div>
          }>
            <TreeRow
              label="Kill switch"
              value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: ks ? '#3fb950' : '#f85149' }}>
                  {ks ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {ks ? 'ON' : 'OFF'}
                </span>
              }
              color={ks ? '#3fb950' : '#f85149'}
            />
          </Tip>
          <Tip position="top" align="left" content={
            <div>
              <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>Quota alert thresholds</div>
              <div style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.5 }}>
                Percentage of the 5h quota that triggers each SSE alert level.<br />
                🟡 warning → 🟠 orange → 🔴 red (kill switch)
              </div>
            </div>
          }>
            <TreeRow
              label="Thresholds"
              last
              value={
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <span style={{ color: '#d29922' }}>{warnYellow}%</span>
                  <span style={{ color: '#f0883e' }}>{warnOrange}%</span>
                  <span style={{ color: '#f85149' }}>{warnRed}%</span>
                </span>
              }
            />
          </Tip>
        </div>
      )}
    </Card>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────

export function SystemView({ config, error, onRetry }: { config?: SystemConfig; error?: boolean; onRetry?: () => void }) {
  if (!config) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
        {error ? (
          <>
            <span style={{ color: '#f85149', fontSize: 13 }}>Error loading system configuration</span>
            {onRetry && (
              <button onClick={onRetry} style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'none', border: '1px solid #f8514966', borderRadius: 5,
                color: '#f85149', transition: 'background 0.15s',
              }}>
                Retry
              </button>
            )}
          </>
        ) : (
          <span style={{ color: '#6e7681', fontSize: 13 }}>Loading system configuration…</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '16px 20px' }}>

      {/* Título de sección */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Layers size={16} color="#58a6ff" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>System map</div>
          <div style={{ fontSize: 11, color: '#484f58' }}>How Claude Code is configured on this machine</div>
        </div>
        {/* Resumen rápido */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tip position="bottom" align="right" content={
            <div style={{ color: '#8b949e', fontSize: 10 }}>Active Claude Code hooks in settings.json</div>
          }>
            <span style={{ fontSize: 10, color: '#d29922', background: '#d2992215', border: '1px solid #d2992235', borderRadius: 4, padding: '2px 7px', cursor: 'help' }}>
              {Object.keys(config.hooks).length} hooks
            </span>
          </Tip>
          <Tip position="bottom" align="right" content={
            <div style={{ color: '#8b949e', fontSize: 10 }}>Available agents in ~/.claude/agents/</div>
          }>
            <span style={{ fontSize: 10, color: '#bc8cff', background: '#bc8cff15', border: '1px solid #bc8cff35', borderRadius: 4, padding: '2px 7px', cursor: 'help' }}>
              {config.agents.length} agents
            </span>
          </Tip>
          <Tip position="bottom" align="right" content={
            <div style={{ color: '#8b949e', fontSize: 10 }}>Workflows in ~/.claude/agents/workflows/</div>
          }>
            <span style={{ fontSize: 10, color: '#56d364', background: '#56d36415', border: '1px solid #56d36435', borderRadius: 4, padding: '2px 7px', cursor: 'help' }}>
              {config.workflows.length} workflows
            </span>
          </Tip>
          <Tip position="bottom" align="right" content={
            <div style={{ color: '#8b949e', fontSize: 10 }}>Skills in ~/.claude/commands/</div>
          }>
            <span style={{ fontSize: 10, color: '#3fb950', background: '#3fb95015', border: '1px solid #3fb95035', borderRadius: 4, padding: '2px 7px', cursor: 'help' }}>
              {config.skills.length} skills
            </span>
          </Tip>
          <Tip position="bottom" align="right" content={
            <div style={{ color: '#8b949e', fontSize: 10 }}>Memory files in Engram</div>
          }>
            <span style={{ fontSize: 10, color: '#58a6ff', background: '#58a6ff15', border: '1px solid #58a6ff35', borderRadius: 4, padding: '2px 7px', cursor: 'help' }}>
              {config.memoryFiles.length} memories
            </span>
          </Tip>
          {onRetry && (
            <Tip position="bottom" align="right" content={
              <div style={{ color: '#8b949e', fontSize: 10 }}>Refresh system configuration</div>
            }>
              <button onClick={onRetry} style={{
                background: 'none', border: '1px solid #30363d', borderRadius: 4,
                padding: '2px 7px', cursor: 'pointer', color: '#6e7681', fontSize: 12,
                lineHeight: 1, transition: 'color 0.15s, border-color 0.15s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e6edf3'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#6e7681' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6e7681'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d' }}
              >↺</button>
            </Tip>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 1200, margin: '0 auto' }}>

        <SkillsSection skills={config.skills} />
        <AgentsSection agents={config.agents} />

        <div style={{ gridColumn: '1 / -1' }}>
          <WorkflowsSection workflows={config.workflows ?? []} />
        </div>

        <ModesSection dist={config.modeDistribution} />
        <HooksSection hooks={config.hooks} />

        <ContextSection files={config.contextFiles} />
        <ClaudestatSection cfg={config.claudestatConfig} />

        <div style={{ gridColumn: '1 / -1' }}>
          <MemorySection memoryFiles={config.memoryFiles} />
        </div>

      </div>
    </div>
  )
}
