/**
 * claude-auth.ts — Lee las credenciales OAuth de Claude Code desde el sistema.
 *
 * macOS: las credenciales se guardan en el keychain del sistema con el servicio
 *        "Claude Code-credentials". El campo "claudeAiOauth" contiene el token
 *        OAuth, su expiración, scopes y el tipo de suscripción del plan.
 *
 * Linux/Windows: Claude Code puede guardar las credenciales en
 *   ~/.config/Claude/credentials.json  (Electron userData path)
 *   o en el keyring del sistema.
 *
 * Propósito: obtener el `subscriptionType` y `rateLimitTier` del plan real del
 * usuario, sin inferirlo del máximo histórico de prompts en los JSONL.
 */

import { execSync } from 'child_process'
import fs           from 'fs'
import path         from 'path'
import os           from 'os'

export interface ClaudeAuthInfo {
  subscriptionType: string       // 'free' | 'pro' | 'max' | 'max5' | 'max20' | ...
  rateLimitTier:    string       // 'default_claude_ai' | 'claude_max' | ...
  expiresAt:        number       // timestamp ms de expiración del token
  tokenValid:       boolean      // true si el token no ha expirado
  source:           'keychain' | 'file' | 'unknown'
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials'

/** Caché en memoria de 5 minutos */
let cache: { data: ClaudeAuthInfo; ts: number } | null = null
const CACHE_TTL = 5 * 60_000

// ─── Leer desde macOS Keychain ────────────────────────────────────────────────

function readFromKeychain(): ClaudeAuthInfo | null {
  try {
    const raw = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`,
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 }
    ).toString().trim()

    if (!raw) return null

    // El valor puede ser JSON directo o base64
    let parsed: any
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64').toString())
    } catch {
      parsed = JSON.parse(raw)
    }

    const oa = parsed?.claudeAiOauth
    if (!oa) return null

    return {
      subscriptionType: (oa.subscriptionType ?? 'unknown').toLowerCase(),
      rateLimitTier:    oa.rateLimitTier ?? 'unknown',
      expiresAt:        oa.expiresAt ?? 0,
      tokenValid:       Date.now() < (oa.expiresAt ?? 0),
      source:           'keychain',
    }
  } catch {
    return null
  }
}

// ─── Leer desde archivo (Linux / Electron userData) ──────────────────────────

function readFromFile(): ClaudeAuthInfo | null {
  const candidates = [
    // Linux Electron userData
    path.join(os.homedir(), '.config', 'Claude', 'credentials.json'),
    path.join(os.homedir(), '.config', 'Claude', '.credentials.json'),
    // macOS Electron userData fallback
    path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'credentials.json'),
    // Windows
    path.join(process.env.APPDATA ?? '', 'Claude', 'credentials.json'),
  ]

  for (const p of candidates) {
    try {
      const raw  = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw)
      const oa   = parsed?.claudeAiOauth ?? parsed
      if (!oa?.subscriptionType) continue

      return {
        subscriptionType: (oa.subscriptionType ?? 'unknown').toLowerCase(),
        rateLimitTier:    oa.rateLimitTier ?? 'unknown',
        expiresAt:        oa.expiresAt ?? 0,
        tokenValid:       Date.now() < (oa.expiresAt ?? 0),
        source:           'file',
      }
    } catch {
      continue
    }
  }
  return null
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Lee las credenciales de autenticación de Claude Code.
 * Intenta: keychain (macOS) → archivo → unknown.
 * Resultado cacheado 5 minutos para no golpear el keychain en cada request.
 */
export function readClaudeAuth(): ClaudeAuthInfo {
  const now = Date.now()
  if (cache && now - cache.ts < CACHE_TTL) return cache.data

  const info = (os.platform() === 'darwin' ? readFromKeychain() : null)
    ?? readFromFile()
    ?? { subscriptionType: 'unknown', rateLimitTier: 'unknown', expiresAt: 0, tokenValid: false, source: 'unknown' as const }

  cache = { data: info, ts: now }
  return info
}

/**
 * Mapea el subscriptionType de las credenciales al ClaudePlan usado por quota-tracker.
 *
 * Valores conocidos de Claude Code:
 *   "free"   → Free plan (10 prompts/5h)
 *   "pro"    → Pro plan  (45 prompts/5h)
 *   "max"    → Max plan — puede ser max5 o max20, diferenciado por rateLimitTier
 *   "max_5"  → Max 5×   (225 prompts/5h)
 *   "max_20" → Max 20×  (900 prompts/5h)
 */
export function subscriptionTypeToPlan(subscriptionType: string, rateLimitTier: string): import('./quota-tracker').ClaudePlan {
  const sub  = subscriptionType.toLowerCase()
  const tier = rateLimitTier.toLowerCase()

  if (sub.includes('max_20') || tier.includes('max_20')) return 'max20'
  if (sub.includes('max_5')  || tier.includes('max_5'))  return 'max5'
  if (sub === 'max' || tier.includes('max'))              return 'max5'  // conservador
  if (sub === 'pro')                                      return 'pro'
  if (sub === 'free')                                     return 'free'

  return 'pro'  // fallback conservador
}
