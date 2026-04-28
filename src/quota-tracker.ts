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
import { readClaudeAuth, subscriptionTypeToPlan } from './claude-auth'

// ─── Planes y límites ─────────────────────────────────────────────────────────

export type ClaudePlan = 'free' | 'pro' | 'max5' | 'max20'

const PLAN_LIMITS: Record<ClaudePlan, {
  prompts5h:         number
  weeklyHoursSonnet: number
  weeklyHoursOpus:   number
}> = {
  free:  { prompts5h: 10,  weeklyHoursSonnet: 40,  weeklyHoursOpus: 0  },
  pro:   { prompts5h: 45,  weeklyHoursSonnet: 80,  weeklyHoursOpus: 0  },
  max5:  { prompts5h: 225, weeklyHoursSonnet: 280, weeklyHoursOpus: 35 },
  max20: { prompts5h: 900, weeklyHoursSonnet: 480, weeklyHoursOpus: 40 },
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface QuotaData {
  // Ciclo de 5 horas
  cyclePrompts:    number   // prompts enviados en el ciclo actual
  cycleLimit:      number   // límite del plan para este ciclo
  cyclePct:        number   // porcentaje usado (0–100)
  cycleResetMs:    number   // ms hasta el próximo reset (calculado desde resetAt)
  cycleResetAt:    number   // timestamp absoluto del próximo reset (rolling window)
  cycleStartTs:    number   // timestamp (ms) del primer mensaje del ciclo actual
  // Semanal por modelo (horas de actividad en ventanas de 5 min)
  weeklyHoursSonnet:  number
  weeklyHoursOpus:    number
  weeklyHoursHaiku:   number
  weeklyTokensSonnet: number
  weeklyTokensOpus:   number
  weeklyTokensHaiku:  number
  weeklyLimitSonnet:  number
  weeklyLimitOpus:   number
  // Burn rate
  burnRateTokensPerMin: number  // tokens/min en los últimos 30 min (0 si sin actividad)
  // Plan
  detectedPlan: ClaudePlan
  planSource:   'config' | 'keychain' | 'inferred'  // origen del plan
  computedAt:   number
}

// ─── Helpers de ventanas temporales ──────────────────────────────────────────

const CYCLE_MS    = 5 * 60 * 60 * 1000   // 5 horas en ms
const WEEK_MS     = 7 * 24 * 60 * 60 * 1000
const WINDOW_5MIN = 5 * 60 * 1000        // ventana de 5 min para agrupar actividad por modelo

/**
 * Calcula el timestamp de reset usando ventana rolling real.
 *
 * Claude Code NO usa floor(now/5h) desde epoch UTC — usa una ventana rolling
 * que empieza desde el primer mensaje del ciclo actual.
 *
 * Enfoque: buscar el primer mensaje humano en los últimos 5h de actividad.
 * resetAt = primerMensaje.ts + 5h
 *
 * Si no hay mensajes en las últimas 5h → el ciclo ya reseteó, el próximo
 * reset es en 5h desde el primer mensaje futuro (mostramos ~5h).
 */
function computeResetAt(entries: ParsedEntry[], now: number): number {
  const fiveHoursAgo = now - CYCLE_MS
  const recentHuman  = entries
    .filter(e => e.type === 'human' && e.ts >= fiveHoursAgo)
    .sort((a, b) => a.ts - b.ts)

  if (recentHuman.length > 0) {
    // Usamos el PRIMER mensaje humano (más antiguo) + 5h
    // = momento en que el primer prompt de la ventana actual expira → cuota empieza a liberarse
    // Los mensajes tool_result de sub-agentes ya están filtrados en el caller
    return recentHuman[0].ts + CYCLE_MS
  }

  // Sin actividad en las últimas 5h → cuota ya libre, no hay reset pendiente
  // Retornar `now` hace que cycleResetMs = 0, la UI puede mostrar "Disponible"
  return now
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
        // Saltar mensajes internos de sub-agentes: su content comienza con tool_result
        // (son respuestas de herramientas que el sub-agente recibe, no prompts del usuario)
        if (Array.isArray(content) && content[0]?.type === 'tool_result') continue
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
    const cycle = Math.floor(e.ts / CYCLE_MS) * CYCLE_MS
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
        // Recopilar todos los subdirectorios a leer: el propio dir + cualquier <uuid>/subagents/
        const subdirs: string[] = [dirPath]
        try {
          for (const entry of fs.readdirSync(dirPath)) {
            const entryPath = path.join(dirPath, entry)
            if (fs.statSync(entryPath).isDirectory()) {
              const subagentsPath = path.join(entryPath, 'subagents')
              if (fs.existsSync(subagentsPath)) subdirs.push(subagentsPath)
            }
          }
        } catch { /* ignorar */ }

        for (const subdir of subdirs) {
          try {
            if (!fs.existsSync(subdir)) continue
            // Recopilar archivos con su mtime para ordenar por recencia y limitar
            const candidates: { path: string; mtime: number }[] = []
            for (const file of fs.readdirSync(subdir)) {
              if (!file.endsWith('.jsonl')) continue
              if (!file.includes('-') || file.length < 15) continue
              try {
                const mtime = fs.statSync(path.join(subdir, file)).mtimeMs
                if (mtime < sinceTs - WEEK_MS) continue
                candidates.push({ path: path.join(subdir, file), mtime })
              } catch { continue }
            }
            // Procesar solo los 300 más recientes — evita bloquear el event loop
            candidates
              .sort((a, b) => b.mtime - a.mtime)
              .slice(0, 300)
              .forEach(c => all.push(...parseJSONLFile(c.path)))
          } catch { /* subdir inaccesible */ }
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

  const weekStart   = getWeekStart(now)
  const thirtyMinAgo = now - 30 * 60 * 1000

  // Leer entradas relevantes (última semana + un poco más para detección de plan)
  const entries = readAllEntries(weekStart - CYCLE_MS)

  // ─ Plan (prioridad: config manual → keychain → inferencia JSONL) ─
  let plan:       ClaudePlan
  let planSource: QuotaData['planSource']

  if (forcePlan) {
    plan       = forcePlan
    planSource = 'config'
  } else {
    // Intentar leer plan desde las credenciales del keychain (más fiable que inferir)
    const auth = readClaudeAuth()
    if (auth.source !== 'unknown' && auth.subscriptionType !== 'unknown') {
      plan       = subscriptionTypeToPlan(auth.subscriptionType, auth.rateLimitTier)
      planSource = 'keychain'
    } else {
      plan       = detectPlan(entries)
      planSource = 'inferred'
    }
  }
  const limits = PLAN_LIMITS[plan]

  // ─ Ciclo 5h: ventana deslizante [now-5h, now] ─
  const fiveHAgo     = now - CYCLE_MS
  const cycleResetAt = computeResetAt(entries, now)
  const cycleStart   = fiveHAgo   // inicio real de la ventana de conteo

  const cyclePrompts = entries.filter(e => e.type === 'human' && e.ts >= fiveHAgo).length
  const cyclePct     = Math.min(100, Math.round(cyclePrompts / limits.prompts5h * 100))
  const cycleResetMs = Math.max(0, cycleResetAt - now)

  // ─ Semanal por modelo: ventanas de 5 min con actividad ─
  // Contamos ventanas de 5 min distintas con al menos 1 respuesta por modelo
  const sonnetWindows = new Set<number>()
  const opusWindows   = new Set<number>()
  const haikuWindows  = new Set<number>()
  let weeklyTokensSonnet = 0
  let weeklyTokensOpus   = 0
  let weeklyTokensHaiku  = 0

  for (const e of entries) {
    if (e.type !== 'assistant' || e.ts < weekStart) continue
    const win    = Math.floor(e.ts / WINDOW_5MIN) * WINDOW_5MIN
    const tokens = (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
    if      (e.model?.includes('opus'))  { opusWindows.add(win);   weeklyTokensOpus   += tokens }
    else if (e.model?.includes('haiku')) { haikuWindows.add(win);  weeklyTokensHaiku  += tokens }
    else                                 { sonnetWindows.add(win); weeklyTokensSonnet += tokens }
  }

  const weeklyHoursSonnet = parseFloat((sonnetWindows.size * 5 / 60).toFixed(1))
  const weeklyHoursOpus   = parseFloat((opusWindows.size   * 5 / 60).toFixed(1))
  const weeklyHoursHaiku  = parseFloat((haikuWindows.size  * 5 / 60).toFixed(1))

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
    cycleResetAt,
    cycleStartTs:      cycleStart,
    weeklyHoursSonnet,
    weeklyHoursOpus,
    weeklyHoursHaiku,
    weeklyTokensSonnet,
    weeklyTokensOpus,
    weeklyTokensHaiku,
    weeklyLimitSonnet: limits.weeklyHoursSonnet,
    weeklyLimitOpus:   limits.weeklyHoursOpus,
    burnRateTokensPerMin,
    detectedPlan:      plan,
    planSource,
    computedAt:        now,
  }

  cache = { data, ts: now }
  return data
}

/** Invalida la caché (llamar cuando llega un nuevo evento para que el siguiente /quota sea fresco) */
export function invalidateQuotaCache(): void {
  cache = null
}
