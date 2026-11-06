/**
 * oc-schema.ts — Detección de versión del esquema de la BD de OpenCode.
 *
 * OpenCode 2.x migró de `session`/`message`/`part` a `session_v2`/`session_message`
 * (las tablas v1 quedan congeladas pero conservan datos históricos).
 * Todas las lecturas de opencode.db pasan por aquí para elegir tablas.
 */

import type { DatabaseSync } from 'node:sqlite'

function tableExists(db: DatabaseSync, name: string): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  } catch {
    return false
  }
}

function hasRows(db: DatabaseSync, name: string): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM "${name}" LIMIT 1`).get()
  } catch {
    return false
  }
}

/**
 * true → usar session_v2/session_message; false → usar session/message/part.
 * Si session_v2 existe pero está vacío y v1 aún tiene datos (migración no
 * ejecutada), se usa v1 para no perder sesiones.
 */
export function hasOcV2(db: DatabaseSync): boolean {
  if (!tableExists(db, 'session_v2')) return false
  if (hasRows(db, 'session_v2')) return true
  if (tableExists(db, 'session')) return !hasRows(db, 'session')
  return true
}

export function ocSessionTable(db: DatabaseSync): string {
  return hasOcV2(db) ? 'session_v2' : 'session'
}
