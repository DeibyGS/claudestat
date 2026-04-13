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
  loops: LoopAlert[]
  efficiencyScore: number   // 0-100
  summary: string           // descripción legible
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

/**
 * Genera el reporte completo de inteligencia para una sesión.
 */
export function analyzeSession(events: EventRow[], costUsd: number): IntelligenceReport {
  const loops           = detectLoops(events)
  const efficiencyScore = calcEfficiencyScore(events, loops, costUsd)

  const summary = buildSummary(loops, efficiencyScore, costUsd, events)

  return { loops, efficiencyScore, summary }
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
    parts.push(`⚠️  Loop detectado: ${loopDesc}`)
  }

  if (score >= 90) parts.push('✅ Sesión eficiente')
  else if (score >= 70) parts.push('⚡ Eficiencia media')
  else parts.push('🔴 Sesión ineficiente')

  const toolCalls = events.filter(e => e.type === 'Done').length
  parts.push(`${toolCalls} tool calls · $${costUsd.toFixed(4)}`)

  return parts.join(' · ')
}
