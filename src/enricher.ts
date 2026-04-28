/**
 * enricher.ts — Enriquecedor de coste desde JSONL de Claude Code
 *
 * Claude Code escribe los tokens de cada respuesta en:
 *   ~/.claude/projects/{project-hash}/{session-id}.jsonl
 *
 * Cada línea de tipo "assistant" contiene:
 *   message.usage.input_tokens
 *   message.usage.output_tokens
 *   message.usage.cache_read_input_tokens
 *   message.usage.cache_creation_input_tokens
 *   message.model
 *
 * El enricher observa cambios en esos archivos (con chokidar),
 * calcula el coste acumulado por sesión y llama al callback
 * para que el daemon actualice la DB y haga broadcast via SSE.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import chokidar from 'chokidar'
import type { CostUpdate } from './db'

// ─── Tabla de precios (USD por millón de tokens) ──────────────────────────────
// Actualizar aquí si Anthropic cambia precios.

interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':            { input: 15,   output: 75,  cacheRead: 1.50, cacheCreate: 18.75 },
  'claude-sonnet-4-6':          { input: 3,    output: 15,  cacheRead: 0.30, cacheCreate: 3.75  },
  'claude-haiku-4-5':           { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4,   cacheRead: 0.08, cacheCreate: 1.00  },
}

// Fallback si el modelo no está en la tabla
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6']

interface UsageEntry {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// ─── Calculo de coste ─────────────────────────────────────────────────────────

function calcCost(model: string, usage: UsageEntry): number {
  const price = PRICING[model] ?? DEFAULT_PRICING
  const M = 1_000_000
  return (
    (usage.input_tokens                  * price.input)       / M +
    (usage.output_tokens                 * price.output)      / M +
    (usage.cache_read_input_tokens       * price.cacheRead)   / M +
    (usage.cache_creation_input_tokens   * price.cacheCreate) / M
  )
}

// ─── Procesamiento de JSONL ───────────────────────────────────────────────────

// Offset de bytes ya leídos por archivo — evita reprocesar líneas anteriores
const fileOffsets = new Map<string, number>()

/**
 * Lee solo las líneas NUEVAS de un JSONL (desde el último offset conocido).
 * Retorna el coste acumulado de TODAS las líneas del archivo (recalculado completo
 * para garantizar consistencia si el archivo fue truncado o reescrito).
 */
function processJSONL(filePath: string): CostUpdate | null {
  let fileContent: string
  try {
    fileContent = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null  // archivo borrado o inaccesible — ignorar
  }

  // Resetear si el archivo es más pequeño que el offset conocido (truncado)
  const currentSize = Buffer.byteLength(fileContent, 'utf8')
  const knownOffset = fileOffsets.get(filePath) ?? 0
  if (currentSize < knownOffset) fileOffsets.set(filePath, 0)

  // Todos los modelos Claude actuales tienen 200K de contexto
  const CONTEXT_WINDOW: Record<string, number> = {
    'claude-opus-4-6':   200_000,
    'claude-sonnet-4-6': 200_000,
    'claude-haiku-4-5':  200_000,
  }

  const totals: CostUpdate = {
    input_tokens: 0, output_tokens: 0,
    cache_read: 0, cache_creation: 0, cost_usd: 0,
    context_used: 0, context_window: 200_000
  }

  // Accumulators for the last entry — overwritten on each iteration
  let lastInputUsd    = 0
  let lastOutputUsd   = 0
  let lastInputTokens  = 0
  let lastOutputTokens = 0
  let lastModel: string | undefined = undefined   // stays undefined until first real assistant line
  let firstTs: number | undefined = undefined     // timestamp of first assistant message

  for (const raw of fileContent.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue

      const msg   = obj.message
      const usage = msg?.usage as UsageEntry | undefined
      const model = (msg?.model as string) ?? undefined

      if (!usage) continue

      // Capture timestamp of first assistant message for sub-agent detection
      if (firstTs === undefined && obj.timestamp) {
        try { firstTs = new Date(obj.timestamp as string).getTime() } catch {}
      }

      totals.input_tokens   += usage.input_tokens                  ?? 0
      totals.output_tokens  += usage.output_tokens                 ?? 0
      totals.cache_read     += usage.cache_read_input_tokens       ?? 0
      totals.cache_creation += usage.cache_creation_input_tokens   ?? 0
      const resolvedModel = model ?? 'claude-sonnet-4-6'
      totals.cost_usd       += calcCost(resolvedModel, usage)

      // The context of the LAST message is most relevant — how much context Claude "sees" now
      totals.context_used   = (usage.input_tokens ?? 0)
                            + (usage.cache_read_input_tokens ?? 0)
                            + (usage.cache_creation_input_tokens ?? 0)
      totals.context_window = CONTEXT_WINDOW[resolvedModel] ?? 200_000

      // Store cost breakdown for THIS entry (overwritten until the last one)
      const price   = PRICING[resolvedModel] ?? DEFAULT_PRICING
      const M       = 1_000_000
      lastInputUsd     = ((usage.input_tokens                  ?? 0) * price.input       +
                          (usage.cache_read_input_tokens       ?? 0) * price.cacheRead   +
                          (usage.cache_creation_input_tokens   ?? 0) * price.cacheCreate) / M
      lastOutputUsd    = ((usage.output_tokens                 ?? 0) * price.output)     / M
      lastInputTokens  = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      lastOutputTokens = usage.output_tokens ?? 0
      lastModel        = model ?? lastModel   // keep previous model if current line has none
    } catch {
      // Línea malformada — ignorar y continuar
    }
  }

  if (lastInputUsd + lastOutputUsd > 0) {
    totals.lastEntry = {
      inputUsd:     lastInputUsd,
      outputUsd:    lastOutputUsd,
      totalUsd:     lastInputUsd + lastOutputUsd,
      inputTokens:  lastInputTokens,
      outputTokens: lastOutputTokens,
    }
  }
  totals.lastModel = lastModel
  totals.firstTs   = firstTs

  fileOffsets.set(filePath, currentSize)
  return totals
}

// ─── Todos los block costs históricos de una sesión ──────────────────────────

import type { BlockCostEntry } from './db'

// Caché con TTL 5 min — evita re-leer el filesystem completo en cada reconexión SSE
const blockCostCache = new Map<string, { data: BlockCostEntry[]; ts: number }>()
const BLOCK_COST_TTL = 5 * 60_000

/**
 * Lee el JSONL completo de una sesión y devuelve los costos de CADA bloque
 * (una entrada por mensaje `assistant`). Usado en el init SSE para restaurar
 * los blockCosts históricos cuando el dashboard se reconecta.
 */
export function getAllBlockCostsForSession(sessionId: string): BlockCostEntry[] {
  const cached = blockCostCache.get(sessionId)
  if (cached && Date.now() - cached.ts < BLOCK_COST_TTL) return cached.data
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return []
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try { if (!fs.statSync(dirPath).isDirectory()) continue } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      if (!fs.existsSync(filePath)) continue

      // Agrupar por bloque (prompt humano real → todos sus sub-turnos assistant)
      // Un bloque = un prompt del usuario + todos los mensajes assistant que Claude
      // genera en respuesta (puede ser más de uno si usa múltiples rondas de tool calls).
      const result: BlockCostEntry[] = []
      let current: BlockCostEntry | null = null
      const content = fs.readFileSync(filePath, 'utf8')

      for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        try {
          const obj = JSON.parse(line)

          // Detectar prompt humano real (no tool_result, no system-reminder)
          if (obj.type === 'human' || obj.type === 'user') {
            const msgContent = obj.message?.content
            // Saltar tool_result — son respuestas de herramientas, no prompts del usuario
            if (Array.isArray(msgContent) && msgContent[0]?.type === 'tool_result') continue
            const text = typeof msgContent === 'string' ? msgContent
              : Array.isArray(msgContent)
                ? ((msgContent as any[]).find((c: any) => c?.type === 'text')?.text ?? '')
                : ''
            if (text.includes('<system-reminder>') || text.includes('<command-name>')) continue
            // Nuevo bloque: crear acumulador y añadir a resultados
            current = { inputUsd: 0, outputUsd: 0, totalUsd: 0, inputTokens: 0, outputTokens: 0 }
            result.push(current)
          }

          // Sub-turno de assistant: acumular en el bloque actual
          if (obj.type === 'assistant' && current) {
            const usage = obj.message?.usage
            const model = (obj.message?.model as string) ?? 'claude-sonnet-4-6'
            if (!usage) continue
            const price    = PRICING[model] ?? DEFAULT_PRICING
            const M        = 1_000_000
            const inUsd    = ((usage.input_tokens                  ?? 0) * price.input       +
                              (usage.cache_read_input_tokens       ?? 0) * price.cacheRead   +
                              (usage.cache_creation_input_tokens   ?? 0) * price.cacheCreate) / M
            const outUsd   = ((usage.output_tokens ?? 0) * price.output) / M
            const inTok    = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            const outTok   = usage.output_tokens ?? 0
            current.inputUsd     += inUsd
            current.outputUsd    += outUsd
            current.totalUsd     += inUsd + outUsd
            current.inputTokens  += inTok
            current.outputTokens += outTok
          }
        } catch {}
      }

      // Filtrar bloques vacíos (sin coste — pueden ser prompts sin respuesta aún)
      const filtered = result.filter(b => b.totalUsd > 0)
      blockCostCache.set(sessionId, { data: filtered, ts: Date.now() })
      return filtered
    }
  } catch {}
  return []
}

// ─── Prompts del usuario por sesión ──────────────────────────────────────────

export interface SessionPrompt {
  index: number   // 1-based — corresponde al bloque del mismo índice
  ts:    number   // timestamp ms
  text:  string   // texto del prompt completo
}

/**
 * Lee los mensajes humanos del JSONL de una sesión.
 * El mensaje #N corresponde al bloque #N del trace.
 */
export function getSessionPrompts(sessionId: string): SessionPrompt[] {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return []
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try { if (!fs.statSync(dirPath).isDirectory()) continue } catch { continue }

      // Buscar también en subdirectorios (subagents)
      const candidates = [
        path.join(dirPath, `${sessionId}.jsonl`),
      ]
      for (const file of candidates) {
        if (!fs.existsSync(file)) continue
        const results: SessionPrompt[] = []
        const content = fs.readFileSync(file, 'utf8')
        let index = 0
        for (const raw of content.split('\n')) {
          const line = raw.trim()
          if (!line) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'human' && obj.type !== 'user') continue
            const ts = obj.timestamp ? new Date(obj.timestamp as string).getTime() : 0
            if (!ts || isNaN(ts)) continue

            // Extraer solo el texto del usuario (ignorar tool_result y system-reminders)
            const msgContent = obj.message?.content
            let text = ''
            if (typeof msgContent === 'string') {
              text = msgContent
            } else if (Array.isArray(msgContent)) {
              // Filtrar bloques tipo 'text', ignorar 'tool_result'
              const textBlocks = (msgContent as any[]).filter(c => c?.type === 'text')
              if (textBlocks.length === 0) continue   // solo tool_result → no es prompt del usuario
              text = textBlocks.map((c: any) => c.text ?? '').join('\n').trim()
            }

            // Filtrar mensajes internos del sistema
            if (
              text.includes('<command-name>') ||
              text.includes('<local-command-stdout>') ||
              text.includes('<system-reminder>') ||
              text.length === 0
            ) continue

            index++
            results.push({
              index,
              ts,
              text,
            })
          } catch {}
        }
        return results
      }
    }
  } catch {}
  return []
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export type CostUpdateCallback    = (sessionId: string, cost: CostUpdate) => void
export type CompactDetectedCallback = (sessionId: string) => void

// Rastrear el último context_used por sesión para detectar auto-compact
const prevContextBySession = new Map<string, number>()

/**
 * Inicia el watcher sobre ~/.claude/projects/.
 * Cuando un .jsonl cambia, calcula el coste y llama al callback.
 *
 * Usamos chokidar porque fs.watch con {recursive:true} no funciona en Linux.
 */
export function startEnricher(onUpdate: CostUpdateCallback, onCompact?: CompactDetectedCallback) {
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.warn(`[enricher] Directorio no encontrado: ${PROJECTS_DIR}`)
    return
  }

  const watcher = chokidar.watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: true,   // no procesar archivos existentes al arrancar (pueden ser grandes)
    awaitWriteFinish: {
      stabilityThreshold: 200,   // esperar 200ms sin cambios antes de procesar
      pollInterval: 100
    }
  })

  // Debounce por archivo: evita doble-procesamiento si chokidar emite eventos rápidos
  // para el mismo archivo (común en algunos sistemas de archivos).
  const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>()

  const handleFile = (filePath: string) => {
    // Extract sessionId from filename: "path/to/{sessionId}.jsonl"
    const sessionId = path.basename(filePath, '.jsonl')

    // Ignore files that don't look like session UUIDs
    if (!sessionId.includes('-') || sessionId.length < 10) return

    // Cancelar procesamiento previo pendiente para este archivo
    const existing = pendingFiles.get(filePath)
    if (existing) clearTimeout(existing)

    // Procesar con un pequeño delay (100ms) para colapsar eventos duplicados
    const timer = setTimeout(() => {
      pendingFiles.delete(filePath)
      const cost = processJSONL(filePath)
      if (cost && cost.cost_usd >= 0) {
        // Detect auto-compact: context drops sharply within the same session
        // (Claude compacts and restarts from near-zero active tokens)
        const prev = prevContextBySession.get(sessionId)
        if (
          onCompact &&
          prev !== undefined &&
          prev > 140_000 &&
          cost.context_used < prev * 0.5
        ) {
          onCompact(sessionId)
        }
        prevContextBySession.set(sessionId, cost.context_used)
        onUpdate(sessionId, cost)
      }
    }, 100)
    pendingFiles.set(filePath, timer)
  }

  // Listen to both 'change' (appends to existing file) and 'add' (new session file).
  // Without 'add', the first assistant response in a brand-new session is missed,
  // leaving lastModel stuck at the Sonnet default.
  watcher.on('change', handleFile)
  watcher.on('add',    handleFile)

  console.log(`[enricher] Observando ${PROJECTS_DIR}`)
}

/**
 * Busca y procesa el JSONL de una sesión específica.
 * Usado al conectar un nuevo cliente SSE para entregar el contexto actual
 * sin esperar al próximo cambio en el archivo.
 */
export function processLatestForSession(sessionId: string, onUpdate: CostUpdateCallback): void {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const dirPath = path.join(PROJECTS_DIR, dir)
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue
      } catch { continue }
      const filePath = path.join(dirPath, `${sessionId}.jsonl`)
      if (fs.existsSync(filePath)) {
        const cost = processJSONL(filePath)
        if (cost && cost.cost_usd >= 0) onUpdate(sessionId, cost)
        return
      }
    }
  } catch { /* ignore — sesión nueva sin JSONL todavía */ }
}
