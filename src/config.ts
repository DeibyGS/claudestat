/**
 * config.ts — Configuración de claudetrace
 *
 * Lee/escribe ~/.claudetrace/config.json con valores por defecto.
 * Los thresholds de warning controlan cuándo se emite una alerta SSE
 * y cuándo se activa el kill switch (hook bloqueante PreToolUse).
 *
 * Estructura del archivo:
 * {
 *   "killSwitchEnabled": true,     // activar/desactivar el hook bloqueante
 *   "killSwitchThreshold": 95,     // % de cuota para bloquear (1-100)
 *   "warnThresholds": [70, 85, 95],// niveles de aviso: amarillo, naranja, rojo
 *   "plan": null                   // forzar plan: "pro"|"max5"|"max20"|null (auto)
 * }
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'
import type { ClaudePlan } from './quota-tracker'

export interface ClaudetraceConfig {
  killSwitchEnabled:  boolean
  killSwitchThreshold: number          // porcentaje (0–100)
  warnThresholds:     number[]         // [amarillo, naranja, rojo] — ej. [70, 85, 95]
  plan:               ClaudePlan | null // null = auto-detect
}

const CONFIG_PATH = path.join(os.homedir(), '.claudetrace', 'config.json')

const DEFAULTS: ClaudetraceConfig = {
  killSwitchEnabled:   true,
  killSwitchThreshold: 95,
  warnThresholds:      [70, 85, 95],
  plan:                null,
}

/** Lee la config del disco. Valores ausentes se rellenan con defaults. */
export function readConfig(): ClaudetraceConfig {
  try {
    const raw  = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ClaudetraceConfig>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Escribe la config en disco. Crea el directorio si no existe. */
export function writeConfig(cfg: ClaudetraceConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n')
}

/** Devuelve el nivel de warning para un % dado, o null si no alcanza ningún threshold. */
export function getWarnLevel(pct: number, thresholds: number[]): 'yellow' | 'orange' | 'red' | null {
  const sorted = [...thresholds].sort((a, b) => a - b)  // [70, 85, 95]
  if (sorted.length >= 3 && pct >= sorted[2]) return 'red'
  if (sorted.length >= 2 && pct >= sorted[1]) return 'orange'
  if (sorted.length >= 1 && pct >= sorted[0]) return 'yellow'
  return null
}
