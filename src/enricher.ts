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

  // Acumular coste de TODAS las líneas assistant del archivo
  const totals: CostUpdate = {
    input_tokens: 0, output_tokens: 0,
    cache_read: 0, cache_creation: 0, cost_usd: 0
  }

  for (const raw of fileContent.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant') continue

      const msg   = obj.message
      const usage = msg?.usage as UsageEntry | undefined
      const model = (msg?.model as string) ?? 'claude-sonnet-4-6'

      if (!usage) continue

      totals.input_tokens   += usage.input_tokens                  ?? 0
      totals.output_tokens  += usage.output_tokens                 ?? 0
      totals.cache_read     += usage.cache_read_input_tokens       ?? 0
      totals.cache_creation += usage.cache_creation_input_tokens   ?? 0
      totals.cost_usd       += calcCost(model, usage)
    } catch {
      // Línea malformada — ignorar y continuar
    }
  }

  fileOffsets.set(filePath, currentSize)
  return totals
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

export type CostUpdateCallback = (sessionId: string, cost: CostUpdate) => void

/**
 * Inicia el watcher sobre ~/.claude/projects/.
 * Cuando un .jsonl cambia, calcula el coste y llama al callback.
 *
 * Usamos chokidar porque fs.watch con {recursive:true} no funciona en Linux.
 */
export function startEnricher(onUpdate: CostUpdateCallback) {
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

  watcher.on('change', (filePath: string) => {
    // Extraer sessionId del nombre del archivo: "path/to/{sessionId}.jsonl"
    const sessionId = path.basename(filePath, '.jsonl')

    // Ignorar archivos que no tienen formato UUID-like
    if (!sessionId.includes('-') || sessionId.length < 10) return

    const cost = processJSONL(filePath)
    if (cost && cost.cost_usd >= 0) {
      onUpdate(sessionId, cost)
    }
  })

  console.log(`[enricher] Observando ${PROJECTS_DIR}`)
}
