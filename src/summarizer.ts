/**
 * summarizer.ts — Resumen de sesión con IA (opcional)
 *
 * Solo se activa si ANTHROPIC_API_KEY está disponible en el entorno.
 * Si no hay key → retorna null silenciosamente, sin errores ni warnings.
 *
 * Usa claude-haiku-4-5 (el modelo más económico) para minimizar coste.
 * Un resumen de sesión consume ~200 tokens → ~$0.0002 por resumen.
 *
 * El cliente de Anthropic se carga con dynamic import para que el daemon
 * no falle si @anthropic-ai/sdk no está instalado o la key no existe.
 */

import type { EventRow } from './db'
import path from 'path'

// Lazy-loaded — se inicializa solo en el primer uso con API key disponible
let client: any = null

async function getClient(): Promise<any> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (client) return client
  try {
    const { Anthropic } = await import('@anthropic-ai/sdk')
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return client
  } catch {
    return null   // SDK no instalado — falla silenciosamente
  }
}

// ─── Contexto de sesión para el prompt ───────────────────────────────────────

function buildContext(events: EventRow[], costUsd: number, projectName?: string): string {
  // Herramientas únicas usadas, ordenadas por frecuencia
  const toolCounts = new Map<string, number>()
  for (const e of events) {
    if (e.tool_name && e.type === 'Done') {
      toolCounts.set(e.tool_name, (toolCounts.get(e.tool_name) ?? 0) + 1)
    }
  }
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t, n]) => `${t}(${n})`)
    .join(', ')

  const toolCount = events.filter(e => e.type === 'Done').length
  const durationMin = events.length > 1
    ? Math.round((events[events.length - 1].ts - events[0].ts) / 60_000)
    : 0

  // Intentar inferir archivos tocados desde tool_input
  const filesSet = new Set<string>()
  for (const e of events) {
    if (!e.tool_input) continue
    try {
      const inp = JSON.parse(e.tool_input)
      const fp  = inp.file_path || inp.path
      if (typeof fp === 'string' && fp.startsWith('/')) {
        filesSet.add(path.basename(fp))
      }
    } catch { /* ignorar */ }
  }
  const files = [...filesSet].slice(0, 5).join(', ')

  return [
    projectName ? `Proyecto: ${projectName}` : '',
    `Duración: ${durationMin}min · ${toolCount} operaciones · $${costUsd.toFixed(4)}`,
    topTools ? `Herramientas: ${topTools}` : '',
    files     ? `Archivos: ${files}` : '',
  ].filter(Boolean).join('\n')
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Genera un resumen de 10-15 palabras de lo que hizo Claude en la sesión.
 * Retorna null si no hay API key o falla la llamada.
 */
export async function summarizeSession(
  events:      EventRow[],
  costUsd:     number,
  projectName?: string
): Promise<string | null> {
  const c = await getClient()
  if (!c) return null

  // No resumir sesiones demasiado cortas (< 3 tool calls)
  if (events.filter(e => e.type === 'Done').length < 3) return null

  const context = buildContext(events, costUsd, projectName)

  try {
    const msg = await c.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages:   [{
        role:    'user',
        content: `Resume en máximo 12 palabras en español qué hizo Claude en esta sesión:\n${context}\n\nResponde solo el resumen, sin comillas ni explicaciones.`,
      }],
    })
    const text = msg.content?.[0]?.type === 'text' ? (msg.content[0].text as string).trim() : null
    return text || null
  } catch {
    return null  // error de API — falla silenciosamente
  }
}
