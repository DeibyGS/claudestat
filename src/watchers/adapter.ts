/**
 * adapter.ts — WatcherAdapter interface + factory para Multi-CLI support
 *
 * Cada CLI coding (Claude Code, Codex, OpenCode, etc.) tiene su propio
 * formato de trazas y ubicación de archivos. Este adapter pattern permite
 * que claudestat las soporte todas con una interfaz común.
 */

import type { CostUpdate } from '../db'

export interface ParsedEvent {
  sessionId: string
  type: string
  toolName?: string
  toolInput?: string
  ts: number
  cwd?: string
}

export interface WatcherAdapter {
  /** Nombre único del CLI (claude-code, codex, opencode, etc.) */
  readonly name: string

  /** Label legible mostrado en UI */
  readonly label: string

  /** Detecta si este CLI está instalado y tiene trazas disponibles */
  detect(): boolean

  /** Directorios/glob a observar con chokidar */
  getWatchPaths(): string[]

  /** Parsea una línea de traza en un ParsedEvent */
  parseEvent(raw: string, filePath: string): ParsedEvent | null

  /** Lee y calcula costos acumulados de un archivo de sesión */
  getSessionCost(filePath: string): Promise<CostUpdate | null>

  /** Nombre amigable para el badge de la CLI (ej: "CC", "Codex") */
  get shortName(): string
}

export interface PollSession {
  sessionId: string
  cost: CostUpdate
  cwd?: string
}

/** Adapters que no usan archivos JSONL sino una DB o API propia */
export interface PollableAdapter extends WatcherAdapter {
  /** Devuelve sesiones actualizadas desde `since` (epoch ms) */
  pollSessions(since: number): Promise<PollSession[]>
}

export function isPollable(adapter: WatcherAdapter): adapter is PollableAdapter {
  return 'pollSessions' in adapter && typeof adapter.pollSessions === 'function'
}

// ─── Factory ───────────────────────────────────────────────────────────────────

const registry = new Map<string, WatcherAdapter>()

export function registerAdapter(adapter: WatcherAdapter): void {
  registry.set(adapter.name, adapter)
}

export function getAdapter(name: string): WatcherAdapter | undefined {
  return registry.get(name)
}

export function getAllAdapters(): WatcherAdapter[] {
  return Array.from(registry.values())
}

export function getActiveAdapters(): WatcherAdapter[] {
  return getAllAdapters().filter(a => a.detect())
}

export function getAdapterNames(): string[] {
  return Array.from(registry.keys())
}
