/**
 * oc-catalog.ts — Per provider/model limits from OpenCode's own models-dev catalog.
 *
 * OpenCode works with many providers (OpenAI, OpenCode Go/Zen, DeepSeek, …) and
 * each model has its own context window, so guessing from a Claude-only table is
 * wrong for most of them. OpenCode caches the models.dev catalog in its SQLite
 * `kv` table (key 'models-dev:v2:catalog', ~12 MB JSON); this module reads it
 * once per catalog version (keyed by the digest in the small ':meta' row) and
 * keeps only a compact provider/model → limits map.
 */

type SqliteDb = { prepare(sql: string): { get(...args: unknown[]): unknown } }

export interface OcModelLimits {
  /** Total window (prompt + output), as models.dev reports it. */
  context?: number
  /** Max prompt size, when the provider caps it below `context`. */
  input?: number
}

const CATALOG_KEY = 'models-dev:v2:catalog'
const META_KEY = `${CATALOG_KEY}:meta`

let cache: { digest: string; limits: Map<string, OcModelLimits> } | null = null

function readValue(db: SqliteDb, key: string): string | null {
  try {
    const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null // older OpenCode without a kv table
  }
}

function loadLimits(db: SqliteDb): Map<string, OcModelLimits> | null {
  const meta = readValue(db, META_KEY)
  let digest = ''
  try { digest = (JSON.parse(meta ?? '{}') as { digest?: string }).digest ?? '' } catch { /* ignore */ }
  if (cache && digest && cache.digest === digest) return cache.limits

  const raw = readValue(db, CATALOG_KEY)
  if (!raw) return null
  try {
    const wrapper = JSON.parse(raw) as { digest?: string; body?: unknown }
    // body is itself a JSON string in current OpenCode versions
    const body = (typeof wrapper.body === 'string' ? JSON.parse(wrapper.body) : wrapper.body) as
      Record<string, { models?: Record<string, { limit?: OcModelLimits }> }>
    const limits = new Map<string, OcModelLimits>()
    for (const [providerId, provider] of Object.entries(body ?? {})) {
      for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
        if (model?.limit) limits.set(`${providerId}/${modelId}`, { context: model.limit.context, input: model.limit.input })
      }
    }
    cache = { digest: digest || wrapper.digest || '', limits }
    return limits
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
  const limit = loadLimits(db)?.get(`${providerId}/${modelId}`)
  return limit?.input ?? limit?.context ?? null
}

/** Test hook: forget the parsed catalog. */
export function resetOcCatalogCache(): void {
  cache = null
}
