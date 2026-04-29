// ─── Rate limiter simple para POST /event ────────────────────────────────────
// Protege contra flood local. Límite: 120 requests/min por IP.
// Usa ventana fija de 60s para simplicidad (sin dependencias externas).

const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60_000

export function isRateLimited(ip: string): boolean {
  const now  = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// Limpiar entradas expiradas cada 5 minutos para no acumular IPs inactivas
setInterval(() => {
  const now = Date.now()
  rateLimitMap.forEach((v, k) => { if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(k) })
}, 5 * 60_000)
