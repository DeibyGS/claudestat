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

const LOOP_THRESHOLD  = 8         // calls para considerar loop (8 evita falsos positivos en sesiones intensas)
const LOOP_WINDOW_MS  = 60_000    // ventana de tiempo: 60 segundos
const LOOP_COOLDOWN_MS = 15_000   // tiempo mínimo entre alertas del mismo tool

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
 * - Loops detectados         → -20 por loop
 * - Tool calls excesivos     → -5 por cada 5 calls sobre el umbral (30)
 * - Coste alto por sesión    → -10 si >$1, -20 si >$5
 *
 * Un score de 100 = sesión perfectamente eficiente.
 * Un score de 0   = sesión con múltiples problemas.
 */
export function calcEfficiencyScore(
  events: EventRow[],
  loops: LoopAlert[],
  costUsd: number
): number {
  let score = 100

  // Penalizar cada loop detectado — máximo -40 para no colapsar el score en sesiones largas
  score -= Math.min(loops.length * 20, 40)

  // Penalizar tool calls excesivos
  const toolCallCount = events.filter(e => e.type === 'Done').length
  if (toolCallCount > 30) {
    score -= Math.floor((toolCallCount - 30) / 5) * 5
  }

  // Penalizar coste alto
  if (costUsd > 5.0) score -= 20
  else if (costUsd > 1.0) score -= 10

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
