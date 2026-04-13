/**
 * db.ts — Capa de acceso a SQLite (node:sqlite)
 *
 * Por qué node:sqlite sobre better-sqlite3:
 * - Integrado en Node 22+, sin compilación nativa
 * - Cross-platform sin configuración extra
 * - API síncrona igual de rápida para uso local
 *
 * El warning "ExperimentalWarning" se suprime en index.ts.
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import os from 'os'
import fs from 'fs'

export const CLAUDETRACE_DIR = path.join(os.homedir(), '.claudetrace')
const DB_PATH = path.join(CLAUDETRACE_DIR, 'events.db')

fs.mkdirSync(CLAUDETRACE_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)

// Migraciones: añadir columnas nuevas sin romper instalaciones previas
try { db.exec(`ALTER TABLE sessions ADD COLUMN project_path TEXT`) } catch { /* ya existe */ }
try { db.exec(`ALTER TABLE sessions ADD COLUMN ai_summary   TEXT`) } catch { /* ya existe */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                     TEXT    PRIMARY KEY,
    cwd                    TEXT,
    project_path           TEXT,
    started_at             INTEGER NOT NULL,
    last_event_at          INTEGER,
    total_cost_usd         REAL    DEFAULT 0,
    total_input_tokens     INTEGER DEFAULT 0,
    total_output_tokens    INTEGER DEFAULT 0,
    total_cache_read       INTEGER DEFAULT 0,
    total_cache_creation   INTEGER DEFAULT 0,
    efficiency_score       INTEGER DEFAULT 100,
    loops_detected         INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    type          TEXT    NOT NULL,
    tool_name     TEXT,
    tool_input    TEXT,
    tool_response TEXT,
    ts            INTEGER NOT NULL,
    cwd           TEXT,
    duration_ms   INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`)

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string
  cwd?: string
  project_path?: string
  started_at: number
  last_event_at?: number
  total_cost_usd?: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_cache_read?: number
  total_cache_creation?: number
  efficiency_score?: number
  loops_detected?: number
  ai_summary?: string
}

export interface EventRow {
  id?: number
  session_id: string
  type: string
  tool_name?: string
  tool_input?: string
  tool_response?: string
  ts: number
  cwd?: string
  duration_ms?: number
}

export interface CostUpdate {
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_creation: number
  cost_usd: number
  context_used: number    // tokens del último request (≈ contexto activo actual)
  context_window: number  // tamaño máximo del modelo (ej: 200000)
}

// ─── Prepared statements (se compilan una vez al iniciar) ─────────────────────

const stmts = {
  upsertSession: db.prepare(`
    INSERT INTO sessions (id, cwd, started_at, last_event_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_event_at = excluded.last_event_at
  `),

  updateSessionCost: db.prepare(`
    UPDATE sessions SET
      total_cost_usd       = ?,
      total_input_tokens   = ?,
      total_output_tokens  = ?,
      total_cache_read     = ?,
      total_cache_creation = ?,
      efficiency_score     = ?,
      loops_detected       = ?
    WHERE id = ?
  `),

  insertEvent: db.prepare(`
    INSERT INTO events (session_id, type, tool_name, tool_input, ts, cwd)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  pairPost: db.prepare(`
    UPDATE events SET type = 'Done', tool_response = ?, duration_ms = ?
    WHERE id = (
      SELECT id FROM events
      WHERE session_id = ? AND type = 'PreToolUse' AND tool_name = ? AND tool_response IS NULL
      ORDER BY ts DESC LIMIT 1
    )
  `),

  getSessionEvents: db.prepare(`
    SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC
  `),

  getLatestSession: db.prepare(`
    SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT 1
  `),

  getAllSessions: db.prepare(`
    SELECT * FROM sessions ORDER BY started_at DESC
  `),

  getSession: db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `),

  updateSessionProject: db.prepare(`
    UPDATE sessions SET project_path = ? WHERE id = ? AND project_path IS NULL
  `),

  getRecentSessions: db.prepare(`
    SELECT s.*, s.ai_summary,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'Done') as done_count,
      (SELECT GROUP_CONCAT(tool_name) FROM (
        SELECT tool_name FROM events WHERE session_id = s.id AND type = 'Done' AND tool_name IS NOT NULL
        GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 3
      )) as top_tools_csv,
      (SELECT COUNT(*) FROM events WHERE session_id = s.id AND tool_name = 'Agent') as agent_count,
      (SELECT COUNT(*) FROM events WHERE session_id = s.id AND tool_name = 'Skill')  as skill_count
    FROM sessions s
    WHERE s.started_at >= ?
    ORDER BY s.started_at DESC
  `),

  updateSessionSummary: db.prepare(`
    UPDATE sessions SET ai_summary = ? WHERE id = ?
  `),

  getProjectAggregates: db.prepare(`
    SELECT
      project_path,
      COUNT(*) as session_count,
      COALESCE(SUM(total_cost_usd),    0) as total_cost_usd,
      COALESCE(SUM(total_input_tokens),0) as total_input_tokens,
      COALESCE(SUM(total_output_tokens),0)as total_output_tokens,
      MAX(last_event_at) as last_active,
      AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END) as avg_efficiency
    FROM sessions
    WHERE project_path IS NOT NULL
    GROUP BY project_path
    ORDER BY last_active DESC
  `)
}

// ─── Operaciones públicas ─────────────────────────────────────────────────────

export const dbOps = {
  upsertSession(s: SessionRow) {
    stmts.upsertSession.run(s.id, s.cwd ?? null, s.started_at, s.last_event_at ?? s.started_at)
  },

  insertEvent(e: EventRow): number {
    const res = stmts.insertEvent.run(
      e.session_id, e.type, e.tool_name ?? null,
      e.tool_input ?? null, e.ts, e.cwd ?? null
    )
    return Number(res.lastInsertRowid)
  },

  /**
   * Al llegar PostToolUse, actualizamos el PreToolUse pendiente más reciente
   * del mismo tool para esta sesión. Esto convierte el par Pre+Post en
   * un único registro de tipo 'Done' con duration_ms calculado.
   */
  pairPostWithPre(sessionId: string, toolName: string, response: string, postTs: number) {
    // Primero obtenemos el ID del PreToolUse pendiente
    const pending = db.prepare(`
      SELECT id, ts FROM events
      WHERE session_id = ? AND type = 'PreToolUse' AND tool_name = ? AND tool_response IS NULL
      ORDER BY ts DESC LIMIT 1
    `).get(sessionId, toolName) as { id: number; ts: number } | undefined

    if (pending) {
      stmts.pairPost.run(response, postTs - pending.ts, sessionId, toolName)
      return pending.id
    }
    return null
  },

  updateSessionCost(sessionId: string, cost: CostUpdate, efficiencyScore: number, loopsDetected: number) {
    stmts.updateSessionCost.run(
      cost.cost_usd,
      cost.input_tokens,
      cost.output_tokens,
      cost.cache_read,
      cost.cache_creation,
      efficiencyScore,
      loopsDetected,
      sessionId
    )
  },

  getSessionEvents(sessionId: string): EventRow[] {
    return stmts.getSessionEvents.all(sessionId) as EventRow[]
  },

  getSession(sessionId: string): SessionRow | undefined {
    return stmts.getSession.get(sessionId) as SessionRow | undefined
  },

  getLatestSession(): SessionRow | undefined {
    return stmts.getLatestSession.get() as SessionRow | undefined
  },

  getAllSessions(): SessionRow[] {
    return stmts.getAllSessions.all() as SessionRow[]
  },

  updateSessionProject(sessionId: string, projectPath: string) {
    stmts.updateSessionProject.run(projectPath, sessionId)
  },

  getRecentSessions(days: number): any[] {
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    return stmts.getRecentSessions.all(since) as any[]
  },

  getProjectAggregates(): any[] {
    return stmts.getProjectAggregates.all() as any[]
  },

  updateSessionSummary(sessionId: string, summary: string) {
    stmts.updateSessionSummary.run(summary, sessionId)
  }
}
