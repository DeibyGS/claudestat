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
  killSwitchForce:      boolean         // if true, blocks instead of just warning (default: false)
  logLevel:             'debug' | 'info' | 'warn' | 'error'
  port:                 number          // puerto del daemon (default: 7337)
  loopThreshold:        number          // calls del mismo tool en ventana para considerar loop
  loopWindowSecs:       number          // tamaño de la ventana en segundos
  projectAliases:       Record<string, string>   // { "/path/to/repo": "MyApp" }
  webhookUrl:           string | null   // URL para alertas externas (null = desactivado)
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
  killSwitchForce:      false,
  logLevel:             'info',
  port:                 7337,
  loopThreshold:        8,
  loopWindowSecs:       120,
  projectAliases:       {},
  webhookUrl:           null,
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
    return 'killSwitchEnabled must be a boolean'

  if ('killSwitchThreshold' in cfg) {
    const v = cfg.killSwitchThreshold
    if (typeof v !== 'number' || isNaN(v) || v < 1 || v > 100)
      return 'killSwitchThreshold must be a number between 1 and 100'
  }

  if ('warnThresholds' in cfg) {
    const v = cfg.warnThresholds
    if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || isNaN(n) || n < 1 || n > 100))
      return 'warnThresholds must be an array of 3 numbers between 1 and 100'
  }

  if ('plan' in cfg && !VALID_PLANS.has(cfg.plan as string | null))
    return `plan must be one of: free, pro, max5, max20, or null`

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
      return 'sessionCostLimitUsd must be a number >= 0 (0 = disabled)'
  }

  if ('alertsEnabled' in cfg && typeof cfg.alertsEnabled !== 'boolean')
    return 'alertsEnabled must be a boolean'

  if ('killSwitchForce' in cfg && typeof cfg.killSwitchForce !== 'boolean')
    return 'killSwitchForce must be boolean'

  if ('logLevel' in cfg && !['debug', 'info', 'warn', 'error'].includes(cfg.logLevel as string))
    return 'logLevel must be: debug, info, warn, error'

  if ('loopThreshold' in cfg) {
    const v = cfg.loopThreshold
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 2 || v > 50)
      return 'loopThreshold must be an integer between 2 and 50'
  }
  if ('loopWindowSecs' in cfg) {
    const v = cfg.loopWindowSecs
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 10 || v > 600)
      return 'loopWindowSecs must be an integer between 10 and 600'
  }
  if ('projectAliases' in cfg) {
    const v = cfg.projectAliases
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return 'projectAliases must be an object { "/path": "Alias" }'
  }
  if ('webhookUrl' in cfg) {
    const v = cfg.webhookUrl
    if (v !== null && (typeof v !== 'string' || (!v.startsWith('http://') && !v.startsWith('https://'))))
      return 'webhookUrl must be null or a valid http/https URL'
  }

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

  if ('port' in cfg) {
    const v = cfg.port
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1024 || v > 65535)
      return 'port must be an integer between 1024 and 65535'
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
