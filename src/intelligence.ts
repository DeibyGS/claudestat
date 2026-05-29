/**
 * intelligence.ts — Detección de loops y scoring de eficiencia
 *
 * Módulo puro: solo recibe datos y retorna análisis.
 * Sin efectos secundarios, sin acceso a DB.
 * Esto lo hace fácil de testear y reutilizar.
 */

import type { EventRow } from './db'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface LoopAlert {
  toolName: string
  count: number       // cuántas veces se llamó en la ventana
  windowMs: number    // tamaño de la ventana temporal
  ts: number          // timestamp del último call del loop
}

export interface IntelligenceReport {
  loops:           LoopAlert[]
  efficiencyScore: number   // 0-100
  summary:         string
  exactRetries:    number   // duplicate tool calls (same name + input)
  errorRate:       number   // 0-1 fraction of Done calls with error in response
  fileChurnScore:  number   // 0-1 unique_files/total_file_calls (lower = more thrashing)
  seqCycleCount:   number   // count of A→B→A triplets in tool sequence
}

// ─── Detección de loops ───────────────────────────────────────────────────────

const LOOP_THRESHOLD   = 8          // calls para considerar loop
const LOOP_WINDOW_MS   = 120_000    // ventana de tiempo: 2 minutos (antes 60s → demasiados falsos positivos en coding)
const LOOP_COOLDOWN_MS = 120_000    // cooldown entre alertas del mismo tool: 2 min (antes 15s → re-alertaba constantemente)

/**
 * Detecta loops: cuando el mismo tool se llama ≥ LOOP_THRESHOLD veces
 * dentro de LOOP_WINDOW_MS. Evita alertas duplicadas con LOOP_COOLDOWN_MS.
 *
 * Algoritmo: ventana deslizante sobre eventos ordenados por timestamp.
 */
export function detectLoops(events: EventRow[]): LoopAlert[] {
  const alerts: LoopAlert[]            = []
  const windowsByTool = new Map<string, number[]>()  // toolName → timestamps en ventana

  for (const ev of events) {
    // Solo contamos tool calls (PreToolUse o Done — uno de los dos)
    if (ev.type !== 'Done' && ev.type !== 'PreToolUse') continue
    if (!ev.tool_name) continue

    const toolName = ev.tool_name
    const ts       = ev.ts

    // Mantener solo los timestamps dentro de la ventana deslizante
    const window = (windowsByTool.get(toolName) || []).filter(t => t >= ts - LOOP_WINDOW_MS)
    window.push(ts)
    windowsByTool.set(toolName, window)

    if (window.length >= LOOP_THRESHOLD) {
      // Verificar cooldown: no alertar si ya alertamos recientemente para este tool
      const lastAlert = [...alerts].reverse().find(a => a.toolName === toolName)
      if (!lastAlert || ts - lastAlert.ts >= LOOP_COOLDOWN_MS) {
        alerts.push({ toolName, count: window.length, windowMs: LOOP_WINDOW_MS, ts })
      }
    }
  }

  return alerts
}

// ─── Scoring de eficiencia ────────────────────────────────────────────────────

/**
 * Calcula un score de 0-100 basado en:
 * - Loops detectados     → -10 por loop, cap -25
 * - Tool calls excesivos → -5 por cada 50 calls sobre el umbral (150), cap -20
 * - Coste alto           → -5 si >$2, -10 si >$10, -20 si >$30
 *
 * Principio: una sesión de coding larga y productiva (88-200 tools) NO debería
 * llegar a 0. El score 0 se reserva para sesiones con loops masivos + coste alto.
 *
 * Ejemplos calibrados:
 *   88 tools, 5 loops, $6.49  → 100 - 25 - 0 - 5  = 70
 *  236 tools, 2 loops, $25.34 → 100 - 20 - 9 - 10  = 61
 *   20 tools, 0 loops, $0.30  → 100 - 0  - 0 - 0   = 100
 */
export function calcEfficiencyScore(
  events: EventRow[],
  loops: LoopAlert[],
  costUsd: number
): number {
  let score = 100

  // Loops: señal fuerte de ineficiencia, pero no colapsa el score
  score -= Math.min(loops.length * 10, 25)

  // Tool calls: solo penalizar si supera un umbral alto (sesiones muy largas)
  const toolCallCount = events.filter(e => e.type === 'Done').length
  if (toolCallCount > 150) {
    score -= Math.min(Math.floor((toolCallCount - 150) / 50) * 5, 20)
  }

  // Coste: escala progresiva, no binaria
  if      (costUsd > 30) score -= 20
  else if (costUsd > 10) score -= 10
  else if (costUsd > 2)  score -= 5

  return Math.max(0, Math.min(100, score))
}

// ─── Semantic metrics ─────────────────────────────────────────────────────────

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep'])

const ERROR_PATTERN = /error:|ENOENT|EACCES|EPERM|permission denied|failed|No such file/i

/**
 * Counts exact duplicate tool calls: same tool_name + same tool_input.
 * Only Done events with non-null tool_name are considered.
 */
export function detectExactRetries(events: EventRow[]): number {
  const seen = new Map<string, number>()
  for (const e of events) {
    if (e.type !== 'Done' || !e.tool_name) continue
    const key = `${e.tool_name}:${e.tool_input ?? ''}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  let retries = 0
  for (const count of seen.values()) {
    if (count > 1) retries += count - 1
  }
  return retries
}

/**
 * Fraction of Done calls whose tool_response matches an error pattern.
 * Returns 0 if there are no Done calls with a response.
 */
export function computeErrorRate(events: EventRow[]): number {
  const done = events.filter(e => e.type === 'Done' && e.tool_response != null)
  if (done.length === 0) return 0
  const errored = done.filter(e => ERROR_PATTERN.test(e.tool_response!))
  return errored.length / done.length
}

/**
 * Diversity of file access: unique_files / total_file_calls.
 * Returns 1.0 when there are no file tool calls (no penalty).
 * Lower values indicate the agent is revisiting the same files repeatedly.
 */
export function computeFileChurn(events: EventRow[]): number {
  const fileCalls = events.filter(e => e.type === 'Done' && FILE_TOOLS.has(e.tool_name ?? ''))
  if (fileCalls.length === 0) return 1.0
  const uniquePaths = new Set<string>()
  for (const e of fileCalls) {
    if (!e.tool_input) continue
    try {
      const inp = JSON.parse(e.tool_input)
      const fp  = inp.file_path ?? inp.path ?? inp.pattern
      if (typeof fp === 'string') uniquePaths.add(fp)
    } catch { /* malformed input */ }
  }
  return uniquePaths.size / fileCalls.length
}

/**
 * Counts A→B→A triplets in the Done event sequence within a 5-minute window.
 * Indicates the agent oscillates between two tools without making progress.
 */
export function detectSeqCycles(events: EventRow[]): number {
  const SEQ_WINDOW_MS = 5 * 60_000
  const done = events.filter(e => e.type === 'Done' && e.tool_name)
  let cycles = 0
  for (let i = 2; i < done.length; i++) {
    if (
      done[i].tool_name === done[i - 2].tool_name &&
      done[i].ts - done[i - 2].ts <= SEQ_WINDOW_MS
    ) {
      cycles++
    }
  }
  return cycles
}

// ─── Semantic loop detection ──────────────────────────────────────────────────

export interface SemanticLoop {
  type: 'tool_sequence' | 'error_persistence'
  turn_start: number
  count: number
  detail: string
}

interface TurnLike {
  turn_index: number
  tool_calls?: string[]
  error_count: number
}

/**
 * Detects two kinds of semantic loops using assistant_turns data:
 * - tool_sequence: same tool_calls signature repeated in ≥2 of the last 5 turns
 * - error_persistence: ≥3 consecutive turns with error_count > 0
 */
export function analyzeSemanticLoops(turns: TurnLike[]): SemanticLoop[] {
  const loops: SemanticLoop[] = []

  // ── error_persistence ────────────────────────────────────────────────────────
  const ERROR_RUN_MIN = 3
  let runStart = -1
  let runLen   = 0
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].error_count > 0) {
      if (runLen === 0) runStart = turns[i].turn_index
      runLen++
    } else {
      if (runLen >= ERROR_RUN_MIN) {
        loops.push({ type: 'error_persistence', turn_start: runStart, count: runLen, detail: `${runLen} consecutive error turns` })
      }
      runLen = 0
    }
  }
  if (runLen >= ERROR_RUN_MIN) {
    loops.push({ type: 'error_persistence', turn_start: runStart, count: runLen, detail: `${runLen} consecutive error turns` })
  }

  // ── tool_sequence: same tool_calls fingerprint in ≥2 of last 5 turns ────────
  const WINDOW = 5
  const fingerprint = (t: TurnLike) => (t.tool_calls ?? []).join(',')
  for (let i = 1; i < turns.length; i++) {
    const fp = fingerprint(turns[i])
    if (!fp) continue
    const window = turns.slice(Math.max(0, i - WINDOW + 1), i)
    const matches = window.filter(t => fingerprint(t) === fp)
    if (matches.length >= 1) {
      const alreadyLogged = loops.some(
        l => l.type === 'tool_sequence' && l.turn_start === turns[i - matches.length].turn_index
      )
      if (!alreadyLogged) {
        const label = (turns[i].tool_calls ?? []).join('→') || 'empty'
        loops.push({
          type:       'tool_sequence',
          turn_start: turns[i - matches.length].turn_index,
          count:      matches.length + 1,
          detail:     `${label} ×${matches.length + 1}`,
        })
      }
    }
  }

  return loops
}

// ─── Predictive saturation ────────────────────────────────────────────────────

export interface SaturationPrediction {
  minutesLeft: number
  pctPerMin:   number
}

/**
 * Linear regression over context_used samples → predicts minutes until 90% of context_window.
 * Returns null if insufficient data or trend is flat/negative.
 */
export function predictSaturation(
  samples: Array<{ ts: number; context_used: number }>,
  contextWindow: number,
): SaturationPrediction | null {
  if (samples.length < 3 || contextWindow <= 0) return null

  const n  = samples.length
  const t0 = samples[0].ts
  const xs = samples.map(s => (s.ts - t0) / 60_000)  // minutes from first sample
  const ys = samples.map(s => s.context_used / contextWindow)  // 0-1 fraction

  const sumX  = xs.reduce((a, b) => a + b, 0)
  const sumY  = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)

  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-9) return null

  const slope     = (n * sumXY - sumX * sumY) / denom  // fraction per minute
  const intercept = (sumY - slope * sumX) / n

  if (slope <= 0) return null  // context shrinking or flat → no saturation risk

  const target      = 0.9
  const currentX    = xs[n - 1]
  const minutesLeft = (target - (intercept + slope * currentX)) / slope

  if (minutesLeft < 0) return null  // already past target

  return { minutesLeft: Math.round(minutesLeft), pctPerMin: Math.round(slope * 100 * 10) / 10 }
}

/**
 * Genera el reporte completo de inteligencia para una sesión.
 */
export function analyzeSession(events: EventRow[], costUsd: number): IntelligenceReport {
  const loops           = detectLoops(events)
  const efficiencyScore = calcEfficiencyScore(events, loops, costUsd)
  const exactRetries    = detectExactRetries(events)
  const errorRate       = computeErrorRate(events)
  const fileChurnScore  = computeFileChurn(events)
  const seqCycleCount   = detectSeqCycles(events)
  const summary         = buildSummary(loops, efficiencyScore, costUsd, events)

  return { loops, efficiencyScore, summary, exactRetries, errorRate, fileChurnScore, seqCycleCount }
}

function buildSummary(
  loops: LoopAlert[],
  score: number,
  costUsd: number,
  events: EventRow[]
): string {
  const parts: string[] = []

  if (loops.length > 0) {
    const loopDesc = loops.map(l => `${l.toolName} x${l.count}`).join(', ')
    parts.push(`⚠️  Loop detected: ${loopDesc}`)
  }

  if (score >= 90) parts.push('✅ Efficient session')
  else if (score >= 70) parts.push('⚡ Medium efficiency')
  else parts.push('🔴 Inefficient session')

  const toolCalls = events.filter(e => e.type === 'Done').length
  parts.push(`${toolCalls} tool calls · $${costUsd.toFixed(4)}`)

  return parts.join(' · ')
}
