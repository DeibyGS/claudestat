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

export const CLAUDESTAT_DIR = process.env.CLAUDESTAT_DATA_DIR ?? path.join(os.homedir(), '.claudestat')
const DB_PATH = process.env.CLAUDESTAT_DB_PATH ?? path.join(CLAUDESTAT_DIR, 'events.db')

fs.mkdirSync(CLAUDESTAT_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)

// Migraciones: añadir columnas nuevas sin romper instalaciones previas
try { db.exec(`ALTER TABLE sessions ADD COLUMN project_path TEXT`) } catch { /* ya existe */ }
try { db.exec(`ALTER TABLE sessions ADD COLUMN ai_summary   TEXT`) } catch { /* ya existe */ }
try { db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL UNIQUE,
    report_markdown TEXT    NOT NULL,
    created_at      TEXT    DEFAULT (datetime('now'))
  )
`) } catch { /* ya existe */ }

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
    loops_detected         INTEGER DEFAULT 0,
    ai_summary             TEXT
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

// Índices para acelerar las subqueries de getRecentSessions (N+3 pattern)
// Wrapped en try-catch para no romper instalaciones que ya los tienen
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_tool       ON events(session_id, tool_name)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_path)`) } catch {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN dominant_model TEXT`) } catch {}
try { db.exec(`ALTER TABLE events ADD COLUMN skill_parent TEXT`) } catch {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`) } catch {}

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
  skill_parent?: string
}

export interface BlockCostEntry {
  inputUsd:    number   // costo de los tokens de entrada (prompt + contexto)
  outputUsd:   number   // costo de los tokens de salida (respuesta de Claude)
  totalUsd:    number
  inputTokens: number   // tokens de entrada de este bloque
  outputTokens: number  // tokens de salida de este bloque
}

export interface CostUpdate {
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_creation: number
  cost_usd: number
  context_used: number    // tokens del último request (≈ contexto activo actual)
  context_window: number  // tamaño máximo del modelo (ej: 200000)
  lastEntry?: BlockCostEntry  // costo desglosado del último request (para block_cost SSE)
  lastModel?: string          // modelo del último request (para mostrar en header)
  firstTs?: number            // timestamp ms del primer mensaje assistant (para detectar sub-agentes)
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
      loops_detected       = ?,
      dominant_model       = ?
    WHERE id = ?
  `),

  insertEvent: db.prepare(`
    INSERT INTO events (session_id, type, tool_name, tool_input, ts, cwd, skill_parent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
      (SELECT json_group_array(tool_name) FROM (
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

  updateSessionParent: db.prepare(`
    UPDATE sessions SET parent_session_id = ? WHERE id = ? AND parent_session_id IS NULL
  `),

  getChildSessions: db.prepare(`
    SELECT id, dominant_model, total_cost_usd, started_at
    FROM sessions WHERE parent_session_id = ? ORDER BY started_at ASC
  `),

  getProjectAggregates: db.prepare(`
    SELECT
      project_path,
      COUNT(*) as session_count,
      COALESCE(SUM(total_cost_usd),    0) as total_cost_usd,
      COALESCE(SUM(total_input_tokens),0) as total_input_tokens,
      COALESCE(SUM(total_output_tokens),0) as total_output_tokens,
      COALESCE(SUM(total_cache_read),0)    as total_cache_read,
      MAX(last_event_at) as last_active,
      AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END) as avg_efficiency
    FROM sessions
    WHERE project_path IS NOT NULL
    GROUP BY project_path
    ORDER BY last_active DESC
  `),

  // Tool usage counts for a specific project — used by pattern analyzer
  getProjectToolCounts: db.prepare(`
    SELECT e.tool_name, COUNT(*) as count
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE s.project_path = ? AND e.type = 'Done' AND e.tool_name IS NOT NULL
    GROUP BY e.tool_name
    ORDER BY count DESC
  `),

  // Session-level aggregates for pattern analysis (cache, loops, cost, efficiency)
  getProjectSessionStats: db.prepare(`
    SELECT
      COUNT(*)                                         as session_count,
      AVG(total_cache_read)                            as avg_cache_read,
      AVG(total_input_tokens + total_cache_read)       as avg_total_input,
      AVG(loops_detected)                              as avg_loops,
      AVG(total_cost_usd)                              as avg_cost_usd,
      AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END) as avg_efficiency
    FROM sessions
    WHERE project_path = ?
  `),

  insertWeeklyReport: db.prepare(`
    INSERT INTO weekly_reports (date, report_markdown)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET report_markdown = excluded.report_markdown, created_at = datetime('now')
  `),

  listWeeklyReports: db.prepare(`
    SELECT id, date, substr(report_markdown, 1, 200) as preview, created_at
    FROM weekly_reports
    ORDER BY date DESC
    LIMIT 52
  `),

  getWeeklyReportByDate: db.prepare(`
    SELECT id, date, report_markdown, created_at FROM weekly_reports WHERE date = ?
  `),

  // Coste oculto: dinero estimado perdido en loops en los últimos N días
  // Fórmula: cost × (loops / done_count)  — fracción de tool calls que fueron desperdicio
  // Ejemplo: 5 loops / 88 tools × $6.49 = $0.37  (mucho más realista que usar efficiency_score)
  getHiddenCostStats: db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN s.loops_detected > 0
        THEN s.total_cost_usd * CAST(s.loops_detected AS REAL) / MAX(1.0,
          (SELECT CAST(COUNT(*) AS REAL) FROM events e WHERE e.session_id = s.id AND e.type = 'Done')
        )
        ELSE 0.0
      END), 0) AS loop_waste_usd,
      COALESCE(SUM(s.total_cost_usd), 0)                           AS total_cost_usd,
      COUNT(CASE WHEN s.loops_detected > 0 THEN 1 END)             AS loop_sessions,
      COALESCE(SUM(s.loops_detected), 0)                           AS total_loops,
      COUNT(*)                                                      AS total_sessions
    FROM sessions s
    WHERE s.started_at >= ?
  `),

  getModeDistribution: db.prepare(`
    SELECT s.id, COUNT(e.id) as agent_count
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id AND e.tool_name = 'Agent'
    WHERE s.started_at > ?
    GROUP BY s.id
  `),

  getQuotaStats: db.prepare(`
    SELECT (total_input_tokens + total_output_tokens + total_cache_read) as total_tokens, total_cost_usd
    FROM sessions
    WHERE started_at > ? AND total_cost_usd > 0
    ORDER BY total_tokens ASC
  `),

  analyticsDaily: db.prepare(`
    SELECT
      date(started_at / 1000, 'unixepoch', 'localtime')          AS date,
      COUNT(*)                                                     AS sessions,
      COALESCE(SUM(total_cost_usd),       0)                      AS cost,
      COALESCE(SUM(total_input_tokens),   0)                      AS input_tokens,
      COALESCE(SUM(total_output_tokens),  0)                      AS output_tokens,
      COALESCE(SUM(total_cache_read),     0)                      AS cache_read,
      COALESCE(SUM(loops_detected),       0)                      AS loops,
      COALESCE(AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END), 100) AS avg_efficiency
    FROM sessions
    WHERE started_at >= ?
    GROUP BY date
    ORDER BY date ASC
  `),

  analyticsByModel: db.prepare(`
    SELECT
      date(started_at / 1000, 'unixepoch', 'localtime')                                AS date,
      COALESCE(dominant_model, 'claude-sonnet-4-6')                                     AS model,
      COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read), 0)     AS tokens,
      COALESCE(SUM(total_cost_usd), 0)                                                  AS cost
    FROM sessions
    WHERE started_at >= ?
    GROUP BY date, model
    ORDER BY date ASC
  `),

  analyticsProjectHours: db.prepare(`
    SELECT
      COALESCE(project_path, 'No project')                      AS project,
      COUNT(*)                                                  AS sessions,
      COALESCE(SUM(last_event_at - started_at), 0) / 3600000.0 AS hours,
      COALESCE(SUM(total_cost_usd), 0)                         AS cost
    FROM sessions
    WHERE started_at >= ?
    GROUP BY project
    ORDER BY hours DESC
    LIMIT 8
  `),
}

// ─── Operaciones públicas ─────────────────────────────────────────────────────

export const dbOps = {
  upsertSession(s: SessionRow) {
    stmts.upsertSession.run(s.id, s.cwd ?? null, s.started_at, s.last_event_at ?? s.started_at)
  },

  insertEvent(e: EventRow): number {
    const res = stmts.insertEvent.run(
      e.session_id, e.type, e.tool_name ?? null,
      e.tool_input ?? null, e.ts, e.cwd ?? null, e.skill_parent ?? null
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
      cost.lastModel ?? null,
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

  getProjectToolCounts(projectPath: string): { tool_name: string; count: number }[] {
    return stmts.getProjectToolCounts.all(projectPath) as { tool_name: string; count: number }[]
  },

  getProjectSessionStats(projectPath: string): any {
    return stmts.getProjectSessionStats.get(projectPath)
  },

  updateSessionSummary(sessionId: string, summary: string) {
    stmts.updateSessionSummary.run(summary, sessionId)
  },

  updateSessionParent(sessionId: string, parentId: string) {
    stmts.updateSessionParent.run(parentId, sessionId)
  },

  getChildSessions(parentSessionId: string): { id: string; dominant_model?: string; total_cost_usd?: number; started_at: number }[] {
    return stmts.getChildSessions.all(parentSessionId) as any[]
  },

  getHiddenCostStats(days: number): {
    loop_waste_usd: number; total_cost_usd: number
    loop_sessions:  number; total_loops:    number; total_sessions: number
  } {
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    return stmts.getHiddenCostStats.get(since) as any
  },

  insertWeeklyReport(date: string, markdown: string) {
    stmts.insertWeeklyReport.run(date, markdown)
  },

  listWeeklyReports(): { id: number; date: string; preview: string; created_at: string }[] {
    return stmts.listWeeklyReports.all() as any[]
  },

  getWeeklyReportByDate(date: string): { id: number; date: string; report_markdown: string; created_at: string } | undefined {
    return stmts.getWeeklyReportByDate.get(date) as any
  },

  getQuotaStats(since: number): Array<{ total_tokens: number; total_cost_usd: number }> {
    return stmts.getQuotaStats.all(since) as Array<{ total_tokens: number; total_cost_usd: number }>
  },

  // Cuenta sesiones por modo: directo (0 agentes), mini (1-3), pipeline (4+)
  getModeDistribution(days: number): { direct: number; mini: number; pipeline: number; total: number } {
    const cutoff = Date.now() - days * 86_400_000
    const rows = stmts.getModeDistribution.all(cutoff) as { id: string; agent_count: number }[]
    let direct = 0, mini = 0, pipeline = 0
    for (const r of rows) {
      if (r.agent_count === 0)     direct++
      else if (r.agent_count <= 6) mini++
      else                         pipeline++
    }
    return { direct, mini, pipeline, total: rows.length }
  },

  getAnalyticsDaily(since: number)   { return stmts.analyticsDaily.all(since)        as any[] },
  getAnalyticsByModel(since: number) { return stmts.analyticsByModel.all(since)       as any[] },
  getProjectHours(since: number)     { return stmts.analyticsProjectHours.all(since)  as any[] },
}
