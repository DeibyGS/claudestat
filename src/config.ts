/**
 * config.ts — Configuración de claudestat
 *
 * Lee/escribe ~/.claudestat/config.json con valores por defecto.
 * Los thresholds de warning controlan cuándo se emite una alerta SSE
 * y cuándo se activa el kill switch (hook bloqueante PreToolUse).
 *
 * Estructura del archivo:
 * {
 *   "killSwitchEnabled": true,     // activar/desactivar el hook bloqueante
 *   "killSwitchThreshold": 95,     // % de cuota para bloquear (1-100)
 *   "warnThresholds": [70, 85, 95],// niveles de aviso: amarillo, naranja, rojo
 *   "plan": null,                  // forzar plan: "pro"|"max5"|"max20"|null (auto)
 *   "reportsEnabled": false,       // activar/desactivar informes automáticos
 *   "reportFrequency": "weekly",   // "weekly"|"biweekly"|"monthly"
 *   "reportDay": 1,                // día de la semana: 0=Dom, 1=Lun … 6=Sáb
 *   "reportTime": "09:00"          // hora HH:MM en que se genera el informe
 * }
 */

import fs   from 'fs'
import path from 'path'
import type { ClaudePlan } from './quota-tracker'
import { getClaudestatDir } from './paths'

export type ReportFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface ClaudestatConfig {
  killSwitchEnabled:    boolean
  killSwitchThreshold:  number          // porcentaje (0–100)
  warnThresholds:       number[]        // cycle 5h alert levels — ej. [70, 85, 95]
  weeklyWarnThresholds: number[]        // weekly alert levels   — ej. [50, 75, 90]
  resetReminderMins:    number          // minutes before cycle reset (0 = disabled)
  sessionCostLimitUsd:  number          // alerta cuando sesión supera este costo en USD (0 = desactivado)
  plan:                 ClaudePlan | null
  reportsEnabled:       boolean
  reportFrequency:      ReportFrequency
  reportDay:            number          // 0=Sun … 6=Sat
  reportTime:           string          // HH:MM
  alertsEnabled:        boolean         // master switch: cycle + weekly + reset + MCP alerts
}

const CONFIG_PATH = path.join(getClaudestatDir(), 'config.json')

const DEFAULTS: ClaudestatConfig = {
  killSwitchEnabled:    false,
  killSwitchThreshold:  95,
  warnThresholds:       [70, 85, 95],
  weeklyWarnThresholds: [50, 75, 90],
  resetReminderMins:    10,
  sessionCostLimitUsd:  0,
  plan:                 null,
  reportsEnabled:       false,
  reportFrequency:      'weekly',
  reportDay:            1,
  reportTime:           '09:00',
  alertsEnabled:        true,
}

/** Lee la config del disco. Valores ausentes se rellenan con defaults. */
export function readConfig(): ClaudestatConfig {
  try {
    const raw  = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ClaudestatConfig>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Escribe la config en disco. Crea el directorio si no existe. */
export function writeConfig(cfg: ClaudestatConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n')
}

const VALID_PLANS = new Set(['free', 'pro', 'max5', 'max20', null])

/**
 * Valida y sanitiza los campos de una config recibida por la API.
 * Devuelve un string de error si algo es inválido, o null si está bien.
 */
export function validateConfig(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'Body debe ser un objeto JSON'
  const cfg = raw as Record<string, unknown>

  if ('killSwitchEnabled' in cfg && typeof cfg.killSwitchEnabled !== 'boolean')
    return 'killSwitchEnabled debe ser boolean'

  if ('killSwitchThreshold' in cfg) {
    const v = cfg.killSwitchThreshold
    if (typeof v !== 'number' || isNaN(v) || v < 1 || v > 100)
      return 'killSwitchThreshold debe ser un número entre 1 y 100'
  }

  if ('warnThresholds' in cfg) {
    const v = cfg.warnThresholds
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || isNaN(n) || n < 1 || n > 100))
      return 'warnThresholds debe ser un array de 3 números entre 1 y 100'
  }

  if ('plan' in cfg && !VALID_PLANS.has(cfg.plan as string | null))
    return `plan debe ser uno de: free, pro, max5, max20 o null`

  if ('weeklyWarnThresholds' in cfg) {
    const v = cfg.weeklyWarnThresholds
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || isNaN(n) || n < 1 || n > 100))
      return 'weeklyWarnThresholds must be an array of 3 numbers between 1 and 100'
  }

  if ('resetReminderMins' in cfg) {
    const v = cfg.resetReminderMins
    if (typeof v !== 'number' || isNaN(v) || v < 0 || v > 60)
      return 'resetReminderMins must be a number between 0 and 60'
  }

  if ('sessionCostLimitUsd' in cfg) {
    const v = cfg.sessionCostLimitUsd
    if (typeof v !== 'number' || isNaN(v) || v < 0)
      return 'sessionCostLimitUsd debe ser un número >= 0 (0 = desactivado)'
  }

  if ('alertsEnabled' in cfg && typeof cfg.alertsEnabled !== 'boolean')
    return 'alertsEnabled debe ser boolean'

  if ('reportsEnabled' in cfg && typeof cfg.reportsEnabled !== 'boolean')
    return 'reportsEnabled debe ser boolean'

  if ('reportFrequency' in cfg && !['weekly', 'biweekly', 'monthly'].includes(cfg.reportFrequency as string))
    return 'reportFrequency debe ser weekly, biweekly o monthly'

  if ('reportDay' in cfg) {
    const v = cfg.reportDay
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 6)
      return 'reportDay debe ser un entero entre 0 y 6'
  }

  if ('reportTime' in cfg) {
    if (typeof cfg.reportTime !== 'string' || !/^\d{2}:\d{2}$/.test(cfg.reportTime as string))
      return 'reportTime debe tener formato HH:MM'
  }

  return null
}

/** Devuelve el nivel de warning para un % dado, o null si no alcanza ningún threshold. */
export function getWarnLevel(pct: number, thresholds: number[]): 'yellow' | 'orange' | 'red' | null {
  const sorted = [...thresholds].sort((a, b) => a - b)  // [70, 85, 95]
  if (sorted.length >= 3 && pct >= sorted[2]) return 'red'
  if (sorted.length >= 2 && pct >= sorted[1]) return 'orange'
  if (sorted.length >= 1 && pct >= sorted[0]) return 'yellow'
  return null
}
