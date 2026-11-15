/**
 * oc-catalog.ts — Per provider/model limits from OpenCode's own models-dev catalog.
 *
 * OpenCode works with many providers (OpenAI, OpenCode Go/Zen, DeepSeek, …) and
 * each model has its own context window, so guessing from a Claude-only table is
 * wrong for most of them. OpenCode caches the models.dev catalog in its SQLite
 * `kv` table (key 'models-dev:v2:catalog', ~12 MB JSON); this module reads it
 * once per catalog version (keyed by the digest in the small ':meta' row) and
 * keeps only a compact provider/model → limits + base prices map.
 */

import type { ModelPricing } from '../model-pricing'

type SqliteDb = { prepare(sql: string): { get(...args: unknown[]): unknown } }

export interface OcModelLimits {
  /** Total window (prompt + output), as models.dev reports it. */
  context?: number
  /** Max prompt size, when the provider caps it below `context`. */
  input?: number
}

interface OcModelInfo {
  limit?: OcModelLimits
  /** Base per-MTok prices; null when the catalog lists no cost for the model. */
  pricing: ModelPricing | null
}

/** Raw models.dev cost shape (only the fields read here). */
interface CatalogCost {
  text?: {
    input?: { price?: number; cache?: { read?: number; write?: number | Record<string, number> } }
    output?: { price?: number }
  }
}

const CATALOG_KEY = 'models-dev:v2:catalog'
const META_KEY = `${CATALOG_KEY}:meta`

let cache: { digest: string; models: Map<string, OcModelInfo> } | null = null

function readValue(db: SqliteDb, key: string): string | null {
  try {
    const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null // older OpenCode without a kv table
  }
}

/**
 * Base text prices. Cache writes come as one number or per TTL
 * ({'5m': …, '1h': …} / {'30m': …}): the shortest TTL (first key) is used.
 * Context-length overrides and region/tier multipliers are not applied, so
 * this is the standard-request API price.
 */
function toPricing(cost: CatalogCost | undefined): ModelPricing | null {
  const input = cost?.text?.input
  const output = cost?.text?.output
  if (typeof input?.price !== 'number' || typeof output?.price !== 'number') return null
  const write = input.cache?.write
  const cacheCreate = typeof write === 'number' ? write : (write ? Object.values(write)[0] ?? 0 : 0)
  return { input: input.price, output: output.price, cacheRead: input.cache?.read ?? 0, cacheCreate }
}

function loadModels(db: SqliteDb): Map<string, OcModelInfo> | null {
  const meta = readValue(db, META_KEY)
  let digest = ''
  try { digest = (JSON.parse(meta ?? '{}') as { digest?: string }).digest ?? '' } catch { /* ignore */ }
  if (cache && digest && cache.digest === digest) return cache.models

  const raw = readValue(db, CATALOG_KEY)
  if (!raw) return null
  try {
    const wrapper = JSON.parse(raw) as { digest?: string; body?: unknown }
    // body is itself a JSON string in current OpenCode versions
    const body = (typeof wrapper.body === 'string' ? JSON.parse(wrapper.body) : wrapper.body) as
      Record<string, { models?: Record<string, { limit?: OcModelLimits; cost?: CatalogCost }> }>
    const models = new Map<string, OcModelInfo>()
    for (const [providerId, provider] of Object.entries(body ?? {})) {
      for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
        if (!model) continue
        models.set(`${providerId}/${modelId}`, {
          limit: model.limit ? { context: model.limit.context, input: model.limit.input } : undefined,
          pricing: toPricing(model.cost),
        })
      }
    }
    cache = { digest: digest || wrapper.digest || '', models }
    return models
  } catch {
    return null
  }
}

/**
 * Context window for an OpenCode provider/model, or null when the catalog has
 * no entry. Uses `limit.input` when present: it is the real cap on the prompt
 * (e.g. 272K on a 400K-total model), and context_used measures prompt tokens.
 */
export function ocContextWindow(db: SqliteDb, providerId: string | undefined, modelId: string): number | null {
  if (!providerId) return null
  const limit = loadModels(db)?.get(`${providerId}/${modelId}`)?.limit
  return limit?.input ?? limit?.context ?? null
}

/** API base prices for an OpenCode provider/model, or null when the catalog has none. */
export function ocModelPricing(db: SqliteDb, providerId: string | undefined, modelId: string): ModelPricing | null {
  if (!providerId) return null
  return loadModels(db)?.get(`${providerId}/${modelId}`)?.pricing ?? null
}

/** Test hook: forget the parsed catalog. */
export function resetOcCatalogCache(): void {
  cache = null
}
