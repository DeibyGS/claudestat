/**
 * quota-tracker.ts — Seguimiento de cuota de uso de Claude Code
 *
 * Calcula en base a los JSONL de ~/.claude/projects/:
 * - Prompts reales en el ciclo actual de 5 horas (ventana deslizante desde epoch UTC)
 * - Tiempo hasta el reset del ciclo
 * - Horas de sesión semanales por modelo (Sonnet vs Opus)
 * - Burn rate: tokens/min promedio de los últimos 30 minutos
 * - Plan detectado automáticamente desde el máximo histórico
 *
 * Por qué 5h desde epoch UTC (no desde una hora fija):
 *   Claude Code usa ventanas deslizantes de exactamente 5 horas desde el epoch Unix.
 *   Ciclo actual = floor(now / 5h) * 5h. El reset ocurre cuando cruza ese límite.
 *
 * Caché de 30 segundos para no re-leer todos los JSONL en cada request del dashboard.
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

// ─── Planes y límites ─────────────────────────────────────────────────────────

export type ClaudePlan = 'free' | 'pro' | 'max5' | 'max20'

const PLAN_LIMITS: Record<ClaudePlan, {
  prompts5h:         number
  weeklyHoursSonnet: number
  weeklyHoursOpus:   number
}> = {
  free:  { prompts5h: 10,  weeklyHoursSonnet: 40,  weeklyHoursOpus: 0  },
  pro:   { prompts5h: 40,  weeklyHoursSonnet: 80,  weeklyHoursOpus: 0  },
  max5:  { prompts5h: 200, weeklyHoursSonnet: 280, weeklyHoursOpus: 35 },
  max20: { prompts5h: 800, weeklyHoursSonnet: 480, weeklyHoursOpus: 40 },
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface QuotaData {
  // Ciclo de 5 horas
  cyclePrompts:    number   // prompts enviados en el ciclo actual
  cycleLimit:      number   // límite del plan para este ciclo
  cyclePct:        number   // porcentaje usado (0–100)
  cycleResetMs:    number   // ms hasta el próximo reset
  cycleStartTs:    number   // timestamp (ms) de inicio del ciclo actual
  // Semanal por modelo
  weeklyHoursSonnet: number
  weeklyHoursOpus:   number
  weeklyLimitSonnet: number
  weeklyLimitOpus:   number
  // Burn rate
  burnRateTokensPerMin: number  // tokens/min en los últimos 30 min (0 si sin actividad)
  // Plan
  detectedPlan: ClaudePlan
  computedAt:   number
}

// ─── Helpers de ventanas temporales ──────────────────────────────────────────

const CYCLE_MS    = 5 * 60 * 60 * 1000   // 5 horas en ms
const WEEK_MS     = 7 * 24 * 60 * 60 * 1000
const WINDOW_5MIN = 5 * 60 * 1000        // ventana de 5 min para agrupar actividad por modelo

function getCycleStart(now: number): number {
  return Math.floor(now / CYCLE_MS) * CYCLE_MS
}

function getWeekStart(now: number): number {
  // Lunes 00:00 hora local
  const d = new Date(now)
  const day = d.getDay()                     // 0=domingo … 6=sábado
  const diff = day === 0 ? -6 : 1 - day      // días hasta el lunes anterior
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ─── Entrada mínima del JSONL ─────────────────────────────────────────────────

interface ParsedEntry {
  ts:           number
  type:         'human' | 'assistant'
  model?:       string
  inputTokens?:  number
  outputTokens?: number
}

// ─── Parser de un archivo JSONL ───────────────────────────────────────────────

function parseJSONLFile(filePath: string): ParsedEntry[] {
  const entries: ParsedEntry[] = []
  let content: string
  try { content = fs.readFileSync(filePath, 'utf8') }
  catch { return entries }

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)

      // Timestamp: ISO string en la raíz del objeto
      const ts = obj.timestamp ? new Date(obj.timestamp as string).getTime() : 0
      if (!ts || isNaN(ts)) continue

      // Mensajes de usuario: tipo 'human' (algunas versiones usan 'user')
      if (obj.type === 'human' || obj.type === 'user') {
        // Filtrar comandos locales — no son prompts reales del usuario
        const content = obj.message?.content
        const text = typeof content === 'string' ? content
          : Array.isArray(content)
            ? (content as any[]).find(c => c?.type === 'text')?.text ?? ''
            : ''
        if (
          text.includes('<command-name>') ||
          text.includes('<local-command-stdout>') ||
          text.includes('<system-reminder>')
        ) continue
        entries.push({ ts, type: 'human' })
      }

      // Respuestas del asistente: tienen datos de uso de tokens
      if (obj.type === 'assistant') {
        const usage = obj.message?.usage
        const model = (obj.message?.model as string | undefined) ?? 'claude-sonnet-4-6'
        entries.push({
          ts, type: 'assistant',
          model,
          inputTokens:  usage?.input_tokens  ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
        })
      }
    } catch {
      // Línea malformada — ignorar y continuar
    }
  }
  return entries
}

// ─── Detección automática de plan ────────────────────────────────────────────

/**
 * Infiere el plan mirando el máximo de prompts humanos en cualquier ciclo de 5h.
 * Si en algún ciclo hubo >200 prompts → Max20. Si >40 → Max5. Si ≤40 → Pro.
 *
 * Es conservador: si nunca se ha llegado al límite, asume Pro.
 */
function detectPlan(entries: ParsedEntry[]): ClaudePlan {
  const countsByCycle = new Map<number, number>()
  for (const e of entries) {
    if (e.type !== 'human') continue
    const cycle = getCycleStart(e.ts)
    countsByCycle.set(cycle, (countsByCycle.get(cycle) ?? 0) + 1)
  }
  const maxSeen = countsByCycle.size > 0 ? Math.max(...countsByCycle.values()) : 0
  if (maxSeen > 200) return 'max20'
  if (maxSeen > 40)  return 'max5'
  return 'pro'
}

// ─── Lector de todos los JSONL ────────────────────────────────────────────────

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

function readAllEntries(sinceTs: number): ParsedEntry[] {
  const all: ParsedEntry[] = []
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return all
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue
        for (const file of fs.readdirSync(dirPath)) {
          if (!file.endsWith('.jsonl')) continue
          if (!file.includes('-') || file.length < 15) continue
          // Optimización: saltear archivos no modificados desde sinceTs
          try {
            const mtime = fs.statSync(path.join(dirPath, file)).mtimeMs
            if (mtime < sinceTs - WEEK_MS) continue  // más de 7 días sin tocar → ignorar
          } catch { continue }
          const entries = parseJSONLFile(path.join(dirPath, file))
          all.push(...entries)
        }
      } catch { /* directorio inaccesible */ }
    }
  } catch { /* PROJECTS_DIR inaccesible */ }
  return all
}

// ─── Caché de 30 segundos ─────────────────────────────────────────────────────

let cache: { data: QuotaData; ts: number } | null = null
const CACHE_TTL = 30_000  // 30 segundos

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Calcula y retorna QuotaData.
 * Usa caché de 30s para no re-leer todos los JSONL en cada request del dashboard.
 * Pasar `forcePlan` para fijar el plan manualmente (por config del usuario).
 */
export function computeQuota(forcePlan?: ClaudePlan): QuotaData {
  const now = Date.now()

  // Devolver caché si está fresco y no se fuerza plan
  if (!forcePlan && cache && now - cache.ts < CACHE_TTL) {
    return cache.data
  }

  const cycleStart  = getCycleStart(now)
  const weekStart   = getWeekStart(now)
  const thirtyMinAgo = now - 30 * 60 * 1000

  // Leer entradas relevantes (última semana + un poco más para detección de plan)
  const entries = readAllEntries(weekStart - CYCLE_MS)

  // ─ Plan ─
  const plan   = forcePlan ?? detectPlan(entries)
  const limits = PLAN_LIMITS[plan]

  // ─ Ciclo 5h: prompts del usuario en la ventana actual ─
  const cyclePrompts = entries.filter(e => e.type === 'human' && e.ts >= cycleStart).length
  const cyclePct     = Math.min(100, Math.round(cyclePrompts / limits.prompts5h * 100))
  const cycleResetMs = (cycleStart + CYCLE_MS) - now

  // ─ Semanal por modelo: ventanas de 5 min con actividad ─
  // Contamos ventanas de 5 min distintas con al menos 1 respuesta por modelo
  const sonnetWindows = new Set<number>()
  const opusWindows   = new Set<number>()

  for (const e of entries) {
    if (e.type !== 'assistant' || e.ts < weekStart) continue
    const win = Math.floor(e.ts / WINDOW_5MIN) * WINDOW_5MIN
    if (e.model?.includes('opus')) opusWindows.add(win)
    else                           sonnetWindows.add(win)
  }

  const weeklyHoursSonnet = parseFloat((sonnetWindows.size * 5 / 60).toFixed(1))
  const weeklyHoursOpus   = parseFloat((opusWindows.size   * 5 / 60).toFixed(1))

  // ─ Burn rate: tokens/min en los últimos 30 min ─
  const recentAssistant = entries.filter(e => e.type === 'assistant' && e.ts >= thirtyMinAgo)
  const totalRecentTok  = recentAssistant.reduce(
    (sum, e) => sum + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 0
  )
  const burnRateTokensPerMin = recentAssistant.length > 0
    ? Math.round(totalRecentTok / 30)
    : 0

  const data: QuotaData = {
    cyclePrompts,
    cycleLimit:        limits.prompts5h,
    cyclePct,
    cycleResetMs,
    cycleStartTs:      cycleStart,
    weeklyHoursSonnet,
    weeklyHoursOpus,
    weeklyLimitSonnet: limits.weeklyHoursSonnet,
    weeklyLimitOpus:   limits.weeklyHoursOpus,
    burnRateTokensPerMin,
    detectedPlan:      plan,
    computedAt:        now,
  }

  cache = { data, ts: now }
  return data
}

/** Invalida la caché (llamar cuando llega un nuevo evento para que el siguiente /quota sea fresco) */
export function invalidateQuotaCache(): void {
  cache = null
}
