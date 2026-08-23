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
import fs from 'fs'
import { getClaudestatDir } from './paths'

export const CLAUDESTAT_DIR = getClaudestatDir()
const DB_PATH = process.env.CLAUDESTAT_DB_PATH ?? path.join(CLAUDESTAT_DIR, 'events.db')

fs.mkdirSync(CLAUDESTAT_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.prepare('PRAGMA journal_mode=WAL').get()
db.exec('PRAGMA busy_timeout=5000')

// ─── Tool response size cap ────────────────────────────────────────────────────

export const TOOL_RESPONSE_MAX_BYTES = 8192

export function capToolResponse(raw: string): string {
  if (Buffer.byteLength(raw, 'utf8') <= TOOL_RESPONSE_MAX_BYTES) return raw
  const buf = Buffer.from(raw, 'utf8').subarray(0, TOOL_RESPONSE_MAX_BYTES)
  return buf.toString('utf8') + `…[truncated: ${raw.length} chars]`
}

// ─── Base tables (idempotent — safe on every start) ───────────────────────────

// meta must exist before runMigrations reads schema_version
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)

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
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, type)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_events_tool       ON events(session_id, tool_name)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_path)`) } catch {}

// ─── Schema migrations ─────────────────────────────────────────────────────────
// Each migration runs exactly once, tracked by meta.schema_version.
// try/catch per migration handles existing installs where columns already exist.

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: `ALTER TABLE sessions ADD COLUMN project_path TEXT` },
  { version: 2, sql: `ALTER TABLE sessions ADD COLUMN ai_summary TEXT` },
  { version: 3, sql: `CREATE TABLE IF NOT EXISTS weekly_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL UNIQUE,
    report_markdown TEXT    NOT NULL,
    created_at      TEXT    DEFAULT (datetime('now'))
  )` },
  { version: 4, sql: `ALTER TABLE sessions ADD COLUMN dominant_model TEXT` },
  { version: 5, sql: `ALTER TABLE events ADD COLUMN skill_parent TEXT` },
  { version: 6, sql: `ALTER TABLE sessions ADD COLUMN parent_session_id TEXT` },
  { version: 7, sql: `ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'claude-code'` },
  { version: 8,  sql: `ALTER TABLE events ADD COLUMN source TEXT DEFAULT 'claude-code'` },
  { version: 9,  sql: `ALTER TABLE sessions ADD COLUMN exact_retries INTEGER DEFAULT 0` },
  { version: 10, sql: `ALTER TABLE sessions ADD COLUMN error_rate REAL DEFAULT 0` },
  { version: 11, sql: `ALTER TABLE sessions ADD COLUMN file_churn_score REAL DEFAULT 0` },
  { version: 12, sql: `ALTER TABLE sessions ADD COLUMN seq_cycle_count INTEGER DEFAULT 0` },
  { version: 13, sql: `ALTER TABLE sessions ADD COLUMN avg_output_chars INTEGER DEFAULT 0` },
  { version: 14, sql: `ALTER TABLE sessions ADD COLUMN error_block_count INTEGER DEFAULT 0` },
  { version: 15, sql: `CREATE TABLE IF NOT EXISTS assistant_turns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT    NOT NULL,
    turn_index   INTEGER NOT NULL,
    ts           INTEGER,
    text_preview TEXT,
    tool_calls   TEXT,
    error_count  INTEGER DEFAULT 0,
    output_chars INTEGER DEFAULT 0,
    UNIQUE(session_id, turn_index) ON CONFLICT REPLACE
  )` },
  { version: 16, sql: `ALTER TABLE sessions ADD COLUMN semantic_loop_count INTEGER DEFAULT 0` },
  { version: 17, sql: `ALTER TABLE assistant_turns ADD COLUMN context_used INTEGER DEFAULT 0` },
  { version: 18, sql: `
    CREATE TABLE IF NOT EXISTS file_intents (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tool           TEXT    NOT NULL,
      session_id     TEXT    NOT NULL,
      task_desc      TEXT,
      status         TEXT    NOT NULL DEFAULT 'active',
      acquired_at    INTEGER NOT NULL,
      released_at    INTEGER,
      last_heartbeat INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_intents_status ON file_intents(status);
  ` },
  { version: 19, sql: `
    CREATE TABLE IF NOT EXISTS file_intent_files (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_id    INTEGER NOT NULL REFERENCES file_intents(id) ON DELETE CASCADE,
      file_path    TEXT    NOT NULL,
      operation    TEXT    NOT NULL DEFAULT 'write',
      line_start   INTEGER,
      line_end     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_intent_files_path ON file_intent_files(file_path);
  ` },
  { version: 20, sql: `ALTER TABLE events ADD COLUMN external_id TEXT` },
  { version: 21, sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ext ON events(session_id, external_id) WHERE external_id IS NOT NULL` },
  { version: 22, sql: `ALTER TABLE sessions ADD COLUMN context_used INTEGER DEFAULT 0` },
  { version: 23, sql: `ALTER TABLE sessions ADD COLUMN context_window INTEGER DEFAULT 0` },
  { version: 24, sql: `
    CREATE TABLE IF NOT EXISTS orchestration_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key       TEXT    NOT NULL UNIQUE,
      project_path  TEXT    NOT NULL,
      project_name  TEXT,
      goal          TEXT,
      status        TEXT    NOT NULL DEFAULT 'active',
      total_cycles  INTEGER DEFAULT 0,
      started_at    TEXT    NOT NULL,
      ended_at      TEXT,
      metrics_json  TEXT,
      snapshot_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orch_runs_project ON orchestration_runs(project_path);
  ` },
  { version: 25, sql: `
    CREATE TABLE IF NOT EXISTS orch_cycle_traces (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key     TEXT    NOT NULL,
      cycle_index INTEGER NOT NULL,
      trace_json  TEXT    NOT NULL DEFAULT '{}',
      frozen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_key, cycle_index) ON CONFLICT REPLACE
    );
  ` },
  { version: 26, sql: `
    ALTER TABLE assistant_turns ADD COLUMN model         TEXT;
    ALTER TABLE assistant_turns ADD COLUMN effort         TEXT;
    ALTER TABLE assistant_turns ADD COLUMN stop_reason    TEXT;
    ALTER TABLE assistant_turns ADD COLUMN stop_sequence  TEXT
  ` },
]

function runMigrations() {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined
  const currentVersion = row ? parseInt(row.value, 10) : 0
  const upsertVersion  = db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)

  for (const m of MIGRATIONS) {
    if (m.version <= currentVersion) continue
    try { db.exec(m.sql) } catch { /* column/table already exists on prior installs */ }
    upsertVersion.run(String(m.version))
  }
}

runMigrations()  // must run before stmts — some queries reference migrated columns

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
  dominant_model?: string
  parent_session_id?: string
  source?: string
  exact_retries?: number
  error_rate?: number
  file_churn_score?: number
  seq_cycle_count?: number
  avg_output_chars?: number
  error_block_count?: number
  semantic_loop_count?: number
  context_used?: number
  context_window?: number
}

export interface AssistantTurnRow {
  turn_index: number
  ts?: number
  text_preview?: string
  tool_calls?: string[]
  error_count: number
  output_chars: number
  context_used: number
  model?: string
  effort?: string
  stop_reason?: string
  stop_sequence?: string
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
  source?: string
}

export interface BlockCostEntry {
  inputUsd:      number
  outputUsd:     number
  totalUsd:      number
  inputTokens:   number
  outputTokens:  number
  cacheRead?:    number
  cacheCreate?:  number
  context_used?:   number
  context_window?: number
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
  lastTs?: number             // timestamp ms del último mensaje assistant (para last_event_at de sub-agentes)
}

export interface BillingBlock {
  block_start:    number
  block_end:      number
  sessions:       number
  total_cost_usd: number
  total_tokens:   number
  is_current:     boolean
}

export interface DailyActivity {
  date:         string
  cost_usd:     number
  total_tokens: number
  tool_calls:   number
}

export interface DailySummary {
  today_cost: number
  today_sessions: number
  today_tokens: number
  today_top_tool: string
  today_top_tool_pct: number
  vs_yesterday_cost_pct: number | null
  vs_yesterday_sessions_delta: number | null
  vs_7d_avg_cost_pct: number | null
  weekly_pace_cost: number
}

export interface OrchRunRow {
  id:            number
  run_key:       string
  project_path:  string
  project_name:  string | null
  goal:          string | null
  status:        string
  total_cycles:  number
  started_at:    string
  ended_at:      string | null
  metrics_json:  string | null
  snapshot_json: string | null
}

// ─── Prepared statements (se compilan una vez al iniciar) ─────────────────────

const stmts = {
  upsertSession: db.prepare(`
    INSERT INTO sessions (id, cwd, started_at, last_event_at, source)
    VALUES (?, ?, ?, ?, COALESCE(?, 'claude-code'))
    ON CONFLICT(id) DO UPDATE SET
      last_event_at = excluded.last_event_at,
      source = COALESCE(excluded.source, source)
  `),

  insertSessionIfAbsent: db.prepare(`
    INSERT OR IGNORE INTO sessions (id, cwd, started_at, last_event_at, source)
    VALUES (?, ?, ?, ?, COALESCE(?, 'claude-code'))
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
      dominant_model       = ?,
      exact_retries        = ?,
      error_rate           = ?,
      file_churn_score     = ?,
      seq_cycle_count      = ?,
      context_used         = ?,
      context_window       = ?
    WHERE id = ?
  `),

  insertEvent: db.prepare(`
    INSERT INTO events (session_id, type, tool_name, tool_input, ts, cwd, skill_parent, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'claude-code'))
  `),

  insertOcEvent: db.prepare(`
    INSERT OR IGNORE INTO events (session_id, type, tool_name, ts, duration_ms, external_id, source)
    VALUES (?, 'Done', ?, ?, ?, ?, 'opencode')
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
  getLatestClaudeSession: db.prepare(`
    SELECT * FROM sessions
    WHERE source IS NULL OR source = 'claude-code'
    ORDER BY last_event_at DESC LIMIT 1
  `),

  getAllSessions: db.prepare(`
    SELECT * FROM sessions ORDER BY started_at DESC LIMIT 500
  `),

  getSessionEventsRecent: db.prepare(`
    SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?
  `),

  getSession: db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `),

  updateSessionProject: db.prepare(`
    UPDATE sessions SET project_path = ? WHERE id = ?
  `),

  touchSession: db.prepare(`
    UPDATE sessions SET last_event_at = ? WHERE id = ? AND last_event_at < ?
  `),

  lastRealEventTime: db.prepare(`
    SELECT session_id, MAX(ts) as last_real_ts
    FROM events
    GROUP BY session_id
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
      AND s.id NOT LIKE 'test-%'
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

  getProjectCliHours: db.prepare(`
    SELECT project_path, COALESCE(source, 'claude-code') as source,
      SUM(last_event_at - started_at) as total_ms
    FROM sessions
    WHERE project_path IS NOT NULL AND last_event_at IS NOT NULL
    GROUP BY project_path, COALESCE(source, 'claude-code')
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

  getProjectStatsBySource: db.prepare(`
    SELECT
      COALESCE(source, 'claude-code')                                                   as source,
      COUNT(*)                                                                           as session_count,
      COALESCE(SUM(total_cost_usd), 0)                                                  as total_cost_usd,
      COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read), 0)     as total_tokens,
      AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END)                     as avg_efficiency,
      AVG(loops_detected)                                                               as avg_loops,
      MAX(last_event_at)                                                                as last_active,
      (SELECT s2.dominant_model
       FROM sessions s2
       WHERE COALESCE(s2.source, 'claude-code') = COALESCE(sessions.source, 'claude-code')
         AND s2.project_path = sessions.project_path
         AND s2.dominant_model IS NOT NULL
       GROUP BY s2.dominant_model
       ORDER BY COUNT(*) DESC LIMIT 1)                                                  as dominant_model
    FROM sessions
    WHERE project_path = ?
    GROUP BY COALESCE(source, 'claude-code')
  `),

  getProjectRecentExtremes: db.prepare(`
    SELECT
      COUNT(CASE WHEN loops_detected >= 5 THEN 1 END) as heavy_loop_sessions,
      COUNT(*)                                         as recent_sessions,
      MAX(total_cost_usd)                              as max_session_cost
    FROM sessions
    WHERE project_path = ?
      AND started_at > (strftime('%s', 'now') - 2592000) * 1000
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

  deleteWeeklyReport: db.prepare(`
    DELETE FROM weekly_reports WHERE date = ?
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
      COALESCE(source, 'claude-code')                             AS source,
      COUNT(*)                                                     AS sessions,
      COALESCE(SUM(total_cost_usd),       0)                      AS cost,
      COALESCE(SUM(total_input_tokens),   0)                      AS input_tokens,
      COALESCE(SUM(total_output_tokens),  0)                      AS output_tokens,
      COALESCE(SUM(total_cache_read),     0)                      AS cache_read,
      COALESCE(SUM(loops_detected),       0)                      AS loops,
      COALESCE(AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END), 100) AS avg_efficiency
    FROM sessions
    WHERE started_at >= ?
    GROUP BY date, COALESCE(source, 'claude-code')
    ORDER BY date ASC
  `),

  analyticsByModel: db.prepare(`
    SELECT
      date(started_at / 1000, 'unixepoch', 'localtime')                                AS date,
      COALESCE(dominant_model, 'claude-sonnet-4-6')                                     AS model,
      COALESCE(source, 'claude-code')                                                   AS source,
      COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read), 0)     AS tokens,
      COALESCE(SUM(total_cost_usd), 0)                                                  AS cost
    FROM sessions
    WHERE started_at >= ?
      AND (dominant_model IS NULL OR dominant_model NOT LIKE '<%')
    GROUP BY date, model, COALESCE(source, 'claude-code')
    ORDER BY date ASC
  `),

  analyticsProjectHours: db.prepare(`
    SELECT
      COALESCE(project_path, 'No project')                      AS project,
      COALESCE(source, 'claude-code')                           AS source,
      COUNT(*)                                                  AS sessions,
      COALESCE(SUM(last_event_at - started_at), 0) / 3600000.0 AS hours,
      COALESCE(SUM(total_cost_usd), 0)                         AS cost
    FROM sessions
    WHERE started_at >= ?
    GROUP BY project, COALESCE(source, 'claude-code')
    ORDER BY hours DESC
    LIMIT 16
  `),

  getTopToolsByCost: db.prepare(`
    WITH session_totals AS (
      SELECT session_id, COUNT(*) AS total_done
      FROM events WHERE type = 'Done' AND ts >= ? GROUP BY session_id
    ),
    tool_per_session AS (
      SELECT e.session_id, e.tool_name,
             COUNT(*) AS cnt,
             COALESCE(SUM(e.duration_ms), 0) AS tool_dur
      FROM events e
      WHERE e.type = 'Done' AND e.tool_name IS NOT NULL AND e.ts >= ?
      GROUP BY e.session_id, e.tool_name
    )
    SELECT
      tps.tool_name,
      COALESCE(s.source, 'claude-code')              AS source,
      SUM(tps.cnt)                                   AS count,
      SUM(tps.tool_dur)                              AS total_duration_ms,
      SUM(CASE WHEN st.total_done > 0
           THEN (tps.cnt * 1.0 / st.total_done) * s.total_cost_usd
           ELSE 0 END)                                AS total_cost_usd
    FROM tool_per_session tps
    JOIN session_totals st ON tps.session_id = st.session_id
    JOIN sessions s ON tps.session_id = s.id
    WHERE (? = 'all' OR COALESCE(s.source, 'claude-code') = ?)
    GROUP BY tps.tool_name, COALESCE(s.source, 'claude-code')
    ORDER BY total_cost_usd DESC
    LIMIT ?
  `),

  getTopToolsByCount: db.prepare(`
    WITH session_totals AS (
      SELECT session_id, COUNT(*) AS total_done
      FROM events WHERE type = 'Done' AND ts >= ? GROUP BY session_id
    ),
    tool_per_session AS (
      SELECT e.session_id, e.tool_name,
             COUNT(*) AS cnt,
             COALESCE(SUM(e.duration_ms), 0) AS tool_dur
      FROM events e
      WHERE e.type = 'Done' AND e.tool_name IS NOT NULL AND e.ts >= ?
      GROUP BY e.session_id, e.tool_name
    )
    SELECT
      tps.tool_name,
      COALESCE(s.source, 'claude-code')              AS source,
      SUM(tps.cnt)                                   AS count,
      SUM(tps.tool_dur)                              AS total_duration_ms,
      SUM(CASE WHEN st.total_done > 0
           THEN (tps.cnt * 1.0 / st.total_done) * s.total_cost_usd
           ELSE 0 END)                                AS total_cost_usd
    FROM tool_per_session tps
    JOIN session_totals st ON tps.session_id = st.session_id
    JOIN sessions s ON tps.session_id = s.id
    WHERE (? = 'all' OR COALESCE(s.source, 'claude-code') = ?)
    GROUP BY tps.tool_name, COALESCE(s.source, 'claude-code')
    ORDER BY count DESC
    LIMIT ?
  `),

  getTopToolsByDuration: db.prepare(`
    WITH session_totals AS (
      SELECT session_id, COUNT(*) AS total_done
      FROM events WHERE type = 'Done' AND ts >= ? GROUP BY session_id
    ),
    tool_per_session AS (
      SELECT e.session_id, e.tool_name,
             COUNT(*) AS cnt,
             COALESCE(SUM(e.duration_ms), 0) AS tool_dur
      FROM events e
      WHERE e.type = 'Done' AND e.tool_name IS NOT NULL AND e.ts >= ?
      GROUP BY e.session_id, e.tool_name
    )
    SELECT
      tps.tool_name,
      COALESCE(s.source, 'claude-code')              AS source,
      SUM(tps.cnt)                                   AS count,
      SUM(tps.tool_dur)                              AS total_duration_ms,
      SUM(CASE WHEN st.total_done > 0
           THEN (tps.cnt * 1.0 / st.total_done) * s.total_cost_usd
           ELSE 0 END)                                AS total_cost_usd
    FROM tool_per_session tps
    JOIN session_totals st ON tps.session_id = st.session_id
    JOIN sessions s ON tps.session_id = s.id
    WHERE (? = 'all' OR COALESCE(s.source, 'claude-code') = ?)
    GROUP BY tps.tool_name, COALESCE(s.source, 'claude-code')
    ORDER BY total_duration_ms DESC
    LIMIT ?
  `),

  getToolCountsBySession: db.prepare(`
    SELECT tool_name, COUNT(*) AS count
    FROM events
    WHERE session_id = ? AND type = 'Done' AND tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY count DESC
  `),

  getToolCountsByRange: db.prepare(`
    SELECT e.tool_name, COUNT(*) AS count
    FROM events e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.type = 'Done' AND e.tool_name IS NOT NULL
      AND e.ts BETWEEN ? AND ?
      AND (? = 'all' OR COALESCE(s.source, 'claude-code') = ?)
    GROUP BY e.tool_name
    ORDER BY count DESC
  `),

  getWeeklyInsight: db.prepare(`
    SELECT
      COUNT(*)                                                      AS total_sessions,
      COALESCE(SUM(total_cost_usd),       0)                        AS total_cost,
      COALESCE(SUM(total_input_tokens),   0)                        AS input_tokens,
      COALESCE(SUM(total_output_tokens),  0)                        AS output_tokens,
      COALESCE(SUM(total_cache_read),     0)                        AS cache_read,
      COALESCE(SUM(loops_detected),       0)                        AS total_loops,
      COALESCE(AVG(CASE WHEN efficiency_score > 0 THEN efficiency_score END), 100) AS avg_efficiency,
      MIN(started_at)                                               AS week_start,
      MAX(last_event_at)                                            AS week_end
    FROM sessions
    WHERE started_at >= ?
  `),

  upsertMeta: db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),

  getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),

  getCostProjection: db.prepare(`
    SELECT
      SUM(total_cost_usd)   AS total_cost_usd,
      MIN(started_at)      AS earliest,
      MAX(last_event_at)   AS latest
    FROM sessions
    WHERE started_at >= ?
  `),

  getProjectCosts: db.prepare(`
    SELECT
      COALESCE(project_path, 'no project') AS project,
      COUNT(*)                              AS session_count,
      COALESCE(SUM(total_cost_usd), 0)     AS total_cost
    FROM sessions
    WHERE started_at >= ? AND total_cost_usd > 0
    GROUP BY project_path
    ORDER BY total_cost DESC
    LIMIT 5
  `),

  updateSessionSemantic: db.prepare(`
    UPDATE sessions SET avg_output_chars = ?, error_block_count = ?, semantic_loop_count = ? WHERE id = ?
  `),

  getAssistantTurns: db.prepare(`
    SELECT turn_index, ts, text_preview, tool_calls, error_count, output_chars, context_used,
           model, effort, stop_reason, stop_sequence
    FROM assistant_turns WHERE session_id = ? ORDER BY turn_index ASC
  `),

  getHourlyDistribution: db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(started_at/1000, 'unixepoch', 'localtime')) AS INTEGER) AS hour,
      COUNT(*) AS session_count
    FROM sessions
    WHERE started_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `),

  getUnattributedCost: db.prepare(`
    WITH period_cost AS (
      SELECT COALESCE(SUM(total_cost_usd), 0) AS total_cost
      FROM sessions WHERE started_at >= ?
    ),
    attributed_cost AS (
      WITH session_totals AS (
        SELECT session_id, COUNT(*) AS total_done
        FROM events WHERE type = 'Done' AND ts >= ? GROUP BY session_id
      ),
      tool_per_session AS (
        SELECT e.session_id,
               COUNT(*) AS cnt
        FROM events e
        WHERE e.type = 'Done' AND e.tool_name IS NOT NULL AND e.ts >= ?
        GROUP BY e.session_id, e.tool_name
      )
      SELECT COALESCE(SUM(
        CASE WHEN st.total_done > 0
             THEN (tps.cnt * 1.0 / st.total_done) * s.total_cost_usd
             ELSE 0 END
      ), 0) AS attributed
      FROM tool_per_session tps
      JOIN session_totals st ON tps.session_id = st.session_id
      JOIN sessions s ON tps.session_id = s.id
      WHERE s.total_cost_usd > 0
    )
    SELECT (pc.total_cost - ac.attributed) AS other_cost_usd
    FROM period_cost pc, attributed_cost ac
  `),

  upsertOrchCycleTrace: db.prepare(`
    INSERT INTO orch_cycle_traces (run_key, cycle_index, trace_json, frozen_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(run_key, cycle_index) DO UPDATE SET
      trace_json = excluded.trace_json,
      frozen_at  = excluded.frozen_at
  `),
  getOrchCycleTrace: db.prepare(`SELECT trace_json FROM orch_cycle_traces WHERE run_key = ? AND cycle_index = ?`),
  upsertOrchRun: db.prepare(`
    INSERT INTO orchestration_runs (run_key, project_path, project_name, goal, status, total_cycles, started_at, ended_at, metrics_json, snapshot_json)
    VALUES (@run_key, @project_path, @project_name, @goal, @status, @total_cycles, @started_at, @ended_at, @metrics_json, @snapshot_json)
    ON CONFLICT(run_key) DO UPDATE SET
      status = excluded.status,
      total_cycles = excluded.total_cycles,
      ended_at = excluded.ended_at,
      metrics_json = excluded.metrics_json,
      snapshot_json = excluded.snapshot_json
  `),

  getOrchRuns: db.prepare(`
    SELECT * FROM orchestration_runs
    WHERE project_path = ?
    ORDER BY started_at DESC
    LIMIT 20
  `),

  getOrchRun: db.prepare(`
    SELECT * FROM orchestration_runs WHERE run_key = ?
  `),

  getOrchAggregates: db.prepare(`
    SELECT
      COALESCE(AVG(j.avg_cost), 0) AS avg_cost_per_cycle,
      COALESCE(AVG(j.avg_dur), 0)  AS avg_duration_secs,
      COALESCE(AVG(j.err_rate), 0) AS avg_error_rate,
      COALESCE(AVG(j.pass_rate), 0) AS avg_verify_pass_rate,
      COUNT(*) AS total_runs
    FROM (
      SELECT
        run_key,
        json_array_length(json_extract(snapshot_json, '$.cycles')) AS cycle_count,
        CASE WHEN json_array_length(json_extract(snapshot_json, '$.cycles')) > 0
          THEN (COALESCE(json_extract(snapshot_json, '$.cc_total_cost'), 0) +
                COALESCE(json_extract(snapshot_json, '$.oc_total_cost'), 0)) /
               json_array_length(json_extract(snapshot_json, '$.cycles'))
          ELSE 0 END AS avg_cost,
        CASE WHEN json_array_length(json_extract(snapshot_json, '$.cycles')) > 0
          THEN (
            SELECT COALESCE(AVG(cy_dur), 0) FROM (
              SELECT json_extract(cy.value, '$.duration_secs') AS cy_dur
              FROM json_each(json_extract(snapshot_json, '$.cycles')) AS cy
            )
          )
          ELSE 0 END AS avg_dur,
        CASE WHEN json_array_length(json_extract(snapshot_json, '$.cycles')) > 0
          THEN (
            SELECT CAST(SUM(CASE WHEN cy_st = 'error' OR cy_st = 'verify_failed' THEN 1 ELSE 0 END) AS REAL) /
                   MAX(1, (SELECT COUNT(*) FROM json_each(json_extract(snapshot_json, '$.cycles'))))
            FROM (
              SELECT json_extract(cy.value, '$.status') AS cy_st
              FROM json_each(json_extract(snapshot_json, '$.cycles')) AS cy
            )
          )
          ELSE 0 END AS err_rate,
        CASE WHEN json_array_length(json_extract(snapshot_json, '$.cycles')) > 0
          THEN (
            SELECT CAST(SUM(CASE WHEN cy_st = 'success' OR cy_vr = 'true' THEN 1 ELSE 0 END) AS REAL) /
                   MAX(1, (SELECT COUNT(*) FROM json_each(json_extract(snapshot_json, '$.cycles'))))
            FROM (
              SELECT json_extract(cy.value, '$.status') AS cy_st,
                     json_extract(cy.value, '$.verified') AS cy_vr
              FROM json_each(json_extract(snapshot_json, '$.cycles')) AS cy
            )
          )
          ELSE 0 END AS pass_rate
      FROM orchestration_runs
      WHERE project_path = ? AND status = 'complete' AND snapshot_json IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 10
    ) j
  `),
}

// ─── Operaciones públicas ─────────────────────────────────────────────────────

export const dbOps = {
  upsertSession(s: SessionRow) {
    stmts.upsertSession.run(s.id, s.cwd ?? null, s.started_at, s.last_event_at ?? s.started_at, s.source ?? null)
  },

  insertEvent(e: EventRow): number {
    const res = stmts.insertEvent.run(
      e.session_id, e.type, e.tool_name ?? null,
      e.tool_input ?? null, e.ts, e.cwd ?? null, e.skill_parent ?? null, e.source ?? null
    )
    return Number(res.lastInsertRowid)
  },

  insertOcEvent(sessionId: string, toolName: string, ts: number, durationMs: number, externalId: string): void {
    stmts.insertOcEvent.run(sessionId, toolName, ts, durationMs, externalId)
  },

  insertSessionIfAbsent(s: SessionRow): void {
    stmts.insertSessionIfAbsent.run(s.id, s.cwd ?? null, s.started_at, s.last_event_at ?? s.started_at, s.source ?? null)
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
      stmts.pairPost.run(capToolResponse(response), postTs - pending.ts, sessionId, toolName)
      return pending.id
    }
    return null
  },

  updateSessionCost(
    sessionId: string,
    cost: CostUpdate,
    efficiencyScore: number,
    loopsDetected: number,
    exactRetries = 0,
    errorRate = 0,
    fileChurnScore = 1,
    seqCycleCount = 0,
  ) {
    stmts.updateSessionCost.run(
      cost.cost_usd,
      cost.input_tokens,
      cost.output_tokens,
      cost.cache_read,
      cost.cache_creation,
      efficiencyScore,
      loopsDetected,
      cost.lastModel ?? null,
      exactRetries,
      errorRate,
      fileChurnScore,
      seqCycleCount,
      cost.context_used,
      cost.context_window,
      sessionId,
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

  getLatestClaudeSession(): SessionRow | undefined {
    return stmts.getLatestClaudeSession.get() as SessionRow | undefined
  },

  getAllSessions(limit = 500): SessionRow[] {
    return db.prepare(`SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?`).all(limit) as SessionRow[]
  },

  getSessionsInRange(startMs: number, endMs: number): SessionRow[] {
    return db.prepare(`SELECT id, started_at, total_cost_usd, total_input_tokens, total_output_tokens, total_cache_read, dominant_model FROM sessions WHERE started_at >= ? AND started_at <= ? ORDER BY started_at ASC`).all(startMs, endMs) as SessionRow[]
  },

  getSessionEventsRecent(sessionId: string, limit = 200): EventRow[] {
    return stmts.getSessionEventsRecent.all(sessionId, limit) as EventRow[]
  },

  getLastRealEventTimes(): Map<string, number> {
    const rows = stmts.lastRealEventTime.all() as Array<{ session_id: string, last_real_ts: number }>
    const map = new Map<string, number>()
    for (const row of rows) map.set(row.session_id, row.last_real_ts)
    return map
  },

  updateSessionProject(sessionId: string, projectPath: string) {
    const existing = this.getSession(sessionId)
    if (existing?.project_path) {
      const cur = existing.project_path.endsWith(path.sep)
        ? existing.project_path : existing.project_path + '/'
      if (!projectPath.startsWith(cur)) return
    }
    stmts.updateSessionProject.run(projectPath, sessionId)
  },

  touchSession(sessionId: string, now = Date.now()) {
    stmts.touchSession.run(now, sessionId, now)
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

  getProjectCliHours(): { project_path: string; source: string; total_ms: number }[] {
    return stmts.getProjectCliHours.all() as { project_path: string; source: string; total_ms: number }[]
  },

  getProjectStatsBySource(projectPath: string): { source: string; session_count: number; total_cost_usd: number; total_tokens: number; avg_efficiency: number | null; avg_loops: number; last_active: number | null; dominant_model: string | null }[] {
    return stmts.getProjectStatsBySource.all(projectPath) as any[]
  },

  getProjectRecentExtremes(projectPath: string): { heavy_loop_sessions: number; recent_sessions: number; max_session_cost: number } {
    return stmts.getProjectRecentExtremes.get(projectPath) as any
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

  deleteWeeklyReport(date: string) {
    stmts.deleteWeeklyReport.run(date)
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

  getCoachEvents(sessionIds: string[]): { session_id: string; type: string; tool_name: string | null; tool_input: string | null; ts: number }[] {
    if (sessionIds.length === 0) return []
    const placeholders = sessionIds.map(() => '?').join(',')
    const cutoff = Date.now() - 2 * 60 * 60_000
    return db.prepare(`
      SELECT session_id, type, tool_name, tool_input, ts
      FROM events
      WHERE session_id IN (${placeholders})
        AND type IN ('PreToolUse', 'Done', 'Stop')
        AND ts > ?
      ORDER BY ts ASC
    `).all(...sessionIds, cutoff) as any[]
  },

  getTopTools(days = 30, by: 'cost' | 'count' | 'duration' = 'cost', limit = 10, source: 'all' | 'claude-code' | 'opencode' = 'all') {
    const since = Date.now() - days * 86_400_000
    const stmt = by === 'count' ? stmts.getTopToolsByCount
      : by === 'duration' ? stmts.getTopToolsByDuration
      : stmts.getTopToolsByCost
    const tools = stmt.all(since, since, source, source, limit) as Array<{
      tool_name: string; source: string; count: number; total_duration_ms: number; total_cost_usd: number
    }>
    if (source === 'all') {
      const other = stmts.getUnattributedCost.get(since, since, since) as { other_cost_usd: number }
      if (other.other_cost_usd > 0) {
        tools.push({ tool_name: 'Other', source: 'claude-code', count: 0, total_duration_ms: 0, total_cost_usd: other.other_cost_usd })
      }
    }
    return tools
  },

  getToolCountsForSession(sessionId: string): Record<string, number> | null {
    const rows = stmts.getToolCountsBySession.all(sessionId) as Array<{ tool_name: string; count: number }>
    if (rows.length === 0) return null
    return Object.fromEntries(rows.map(r => [r.tool_name, r.count]))
  },

  getToolCountsByRange(startMs: number, endMs: number, source: 'claude-code' | 'opencode' | 'all' = 'all'): Record<string, number> | null {
    const rows = stmts.getToolCountsByRange.all(startMs, endMs, source, source) as Array<{ tool_name: string; count: number }>
    if (rows.length === 0) return null
    return Object.fromEntries(rows.map(r => [r.tool_name, r.count]))
  },

  getWeeklyInsight(days = 7) {
    const since = Date.now() - days * 86_400_000
    return stmts.getWeeklyInsight.get(since) as {
      total_sessions: number; total_cost: number
      input_tokens: number; output_tokens: number; cache_read: number
      total_loops: number; avg_efficiency: number
      week_start: number; week_end: number
    }
  },

  getPrevWeekInsight() {
    const now      = Date.now()
    const weekEnd  = now - 7 * 86_400_000
    const weekStart = now - 14 * 86_400_000

    const row = db.prepare(`
      SELECT
        COUNT(*)                               AS total_sessions,
        COALESCE(SUM(total_cost_usd), 0)       AS total_cost,
        COALESCE(SUM(total_input_tokens), 0)   AS input_tokens,
        COALESCE(SUM(total_output_tokens), 0)  AS output_tokens,
        COALESCE(SUM(total_cache_read), 0)     AS cache_read,
        COALESCE(SUM(loops_detected), 0)       AS total_loops,
        COALESCE(AVG(efficiency_score), 100)   AS avg_efficiency,
        MIN(started_at)                        AS week_start,
        MAX(started_at)                        AS week_end
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
    `).get(weekStart, weekEnd) as any

    return {
      total_sessions: row.total_sessions ?? 0,
      total_cost:     row.total_cost     ?? 0,
      input_tokens:   row.input_tokens   ?? 0,
      output_tokens:  row.output_tokens  ?? 0,
      cache_read:     row.cache_read     ?? 0,
      total_loops:    row.total_loops    ?? 0,
      avg_efficiency: row.avg_efficiency ?? 100,
      week_start:     row.week_start     ?? weekStart,
      week_end:       row.week_end       ?? null,
    }
  },

  setMeta(key: string, value: string) {
    stmts.upsertMeta.run(key, value)
  },

  getMeta(key: string): string | undefined {
    const row = stmts.getMeta.get(key) as { value: string } | undefined
    return row?.value
  },

  getCostProjection(days = 7) {
    const since = Date.now() - days * 86_400_000
    return stmts.getCostProjection.get(since) as {
      total_cost_usd: number; earliest: number; latest: number
    }
  },

  getProjectCosts(days = 7) {
    const since = Date.now() - days * 86_400_000
    return stmts.getProjectCosts.all(since) as { project: string; session_count: number; total_cost: number }[]
  },

  getHourlyDistribution(days = 7) {
    const since = Date.now() - days * 86_400_000
    return stmts.getHourlyDistribution.all(since) as { hour: number; session_count: number }[]
  },

  updateSessionSemantic(sessionId: string, avgOutputChars: number, errorBlockCount: number, semanticLoopCount = 0) {
    stmts.updateSessionSemantic.run(avgOutputChars, errorBlockCount, semanticLoopCount, sessionId)
  },

  upsertAssistantTurns(sessionId: string, turns: AssistantTurnRow[]) {
    db.prepare(`DELETE FROM assistant_turns WHERE session_id = ?`).run(sessionId)
    const insert = db.prepare(`
      INSERT INTO assistant_turns (session_id, turn_index, ts, text_preview, tool_calls, error_count, output_chars, context_used, model, effort, stop_reason, stop_sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const t of turns) {
      insert.run(
        sessionId, t.turn_index, t.ts ?? null, t.text_preview ?? null, JSON.stringify(t.tool_calls ?? []),
        t.error_count, t.output_chars, t.context_used,
        t.model ?? null, t.effort ?? null, t.stop_reason ?? null, t.stop_sequence ?? null,
      )
    }
  },

  getAssistantTurns(sessionId: string): AssistantTurnRow[] {
    const rows = stmts.getAssistantTurns.all(sessionId) as any[]
    return rows.map(r => ({
      turn_index:   r.turn_index,
      ts:           r.ts ?? undefined,
      text_preview: r.text_preview ?? undefined,
      tool_calls:   r.tool_calls ? JSON.parse(r.tool_calls) : [],
      error_count:  r.error_count,
      output_chars: r.output_chars,
      context_used: r.context_used ?? 0,
      model:        r.model ?? undefined,
      effort:       r.effort ?? undefined,
      stop_reason:  r.stop_reason ?? undefined,
      stop_sequence: r.stop_sequence ?? undefined,
    }))
  },

  getCacheReadByModel(days: number) {
    const since = Date.now() - days * 86_400_000
    return db.prepare(`
      SELECT COALESCE(dominant_model, 'unknown') as model, SUM(total_cache_read) as cache_read
      FROM sessions
      WHERE started_at >= ?
      GROUP BY dominant_model
    `).all(since) as { model: string; cache_read: number }[]
  },

  getModelBreakdown(days: number) {
    const since = Date.now() - days * 86_400_000
    return db.prepare(`
      SELECT
        COALESCE(dominant_model, 'unknown') as model,
        SUM(total_cost_usd) as total_cost,
        COUNT(*) as session_count
      FROM sessions
      WHERE started_at >= ?
      GROUP BY dominant_model
      ORDER BY total_cost DESC
    `).all(since) as { model: string; total_cost: number; session_count: number }[]
  },

  // ─── File intent coordination ──────────────────────────────────────────────

  insertIntent(tool: string, sessionId: string, taskDesc: string | undefined): number {
    const res = db.prepare(`
      INSERT INTO file_intents (tool, session_id, task_desc, status, acquired_at, last_heartbeat)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(tool, sessionId, taskDesc ?? null, Date.now(), Date.now())
    return Number(res.lastInsertRowid)
  },

  insertIntentFile(intentId: number, filePath: string, operation: string, lineStart?: number, lineEnd?: number) {
    db.prepare(`
      INSERT INTO file_intent_files (intent_id, file_path, operation, line_start, line_end)
      VALUES (?, ?, ?, ?, ?)
    `).run(intentId, filePath, operation, lineStart ?? null, lineEnd ?? null)
  },

  getWriteConflicts(filePaths: string[], excludeTool: string): { file_path: string; tool: string; session_id: string; task_desc: string | null; acquired_at: number }[] {
    if (filePaths.length === 0) return []
    const placeholders = filePaths.map(() => '?').join(',')
    return db.prepare(`
      SELECT f.file_path, i.tool, i.session_id, i.task_desc, i.acquired_at
      FROM file_intent_files f
      JOIN file_intents i ON i.id = f.intent_id
      WHERE f.file_path IN (${placeholders})
        AND f.operation = 'write'
        AND i.status = 'active'
        AND i.tool != ?
    `).all(...filePaths, excludeTool) as { file_path: string; tool: string; session_id: string; task_desc: string | null; acquired_at: number }[]
  },

  getIntent(id: number): { tool: string; session_id: string; task_desc: string | null } | undefined {
    return db.prepare(`SELECT tool, session_id, task_desc FROM file_intents WHERE id = ?`).get(id) as any
  },

  releaseIntent(id: number) {
    db.prepare(`
      UPDATE file_intents SET status = 'done', released_at = ? WHERE id = ?
    `).run(Date.now(), id)
  },

  heartbeatIntent(id: number) {
    db.prepare(`
      UPDATE file_intents SET last_heartbeat = ? WHERE id = ? AND status = 'active'
    `).run(Date.now(), id)
  },

  getIntentFiles(id: number): { file_path: string; operation: string }[] {
    return db.prepare(`
      SELECT file_path, operation FROM file_intent_files WHERE intent_id = ?
    `).all(id) as { file_path: string; operation: string }[]
  },

  getActiveToolsInProject(projectPath: string, excludeTool: string): { source: string; last_event_at: number }[] {
    const since = Date.now() - 10 * 60_000
    return db.prepare(`
      SELECT COALESCE(source, 'claude-code') AS source, MAX(last_event_at) AS last_event_at
      FROM sessions
      WHERE project_path = ?
        AND COALESCE(source, 'claude-code') != ?
        AND last_event_at >= ?
      GROUP BY COALESCE(source, 'claude-code')
    `).all(projectPath, excludeTool, since) as { source: string; last_event_at: number }[]
  },

  releaseOrphanedIntents(): void {
    db.prepare(`UPDATE file_intents SET status = 'stale' WHERE status = 'active'`).run()
    db.prepare(`DELETE FROM file_intents WHERE status IN ('done','stale')`).run()
  },

  markStaleIntents(): { id: number; tool: string; task_desc: string | null }[] {
    const cutoff = Date.now() - 10 * 60_000
    const stale = db.prepare(`
      SELECT id, tool, task_desc FROM file_intents
      WHERE status = 'active' AND (last_heartbeat IS NULL OR last_heartbeat < ?)
    `).all(cutoff) as { id: number; tool: string; task_desc: string | null }[]
    if (stale.length > 0) {
      const ids = stale.map(s => s.id)
      db.prepare(`UPDATE file_intents SET status = 'stale' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
    }
    return stale
  },

  deleteOldStaleIntents() {
    const cutoff = Date.now() - 60 * 60_000
    db.prepare(`DELETE FROM file_intents WHERE status IN ('done','stale') AND COALESCE(released_at, acquired_at) < ?`).run(cutoff)
  },

  hasActiveIntent(tool: string, filePath: string): boolean {
    const row = db.prepare(`
      SELECT 1 FROM file_intents i
      JOIN file_intent_files f ON f.intent_id = i.id
      WHERE i.tool = ? AND f.file_path = ? AND i.status = 'active'
      LIMIT 1
    `).get(tool, filePath)
    return !!row
  },

  getActiveIntents(): { id: number; tool: string; file_path: string }[] {
    return db.prepare(`
      SELECT i.id, i.tool, f.file_path
      FROM file_intents i
      JOIN file_intent_files f ON f.intent_id = i.id
      WHERE i.status = 'active'
    `).all() as { id: number; tool: string; file_path: string }[]
  },

  getBillingBlocks(limit = 20): BillingBlock[] {
    const rows = db.prepare(`
      SELECT
        (started_at / 18000000) * 18000000           AS block_start,
        (started_at / 18000000) * 18000000 + 18000000 AS block_end,
        COUNT(*)                                      AS sessions,
        COALESCE(SUM(total_cost_usd), 0)              AS total_cost_usd,
        COALESCE(SUM(total_input_tokens + total_output_tokens), 0) AS total_tokens
      FROM sessions
      WHERE started_at > 0
      GROUP BY (started_at / 18000000)
      ORDER BY block_start DESC
      LIMIT ?
    `).all(limit) as Array<{
      block_start: number; block_end: number; sessions: number
      total_cost_usd: number; total_tokens: number
    }>
    const currentBlock = Math.floor(Date.now() / 18_000_000) * 18_000_000
    return rows.map(r => ({ ...r, is_current: r.block_start === currentBlock }))
  },

  getDailyActivity(days = 365): DailyActivity[] {
    const since = Date.now() - days * 86400000
    return db.prepare(`
      SELECT
        strftime('%Y-%m-%d', s.started_at / 1000, 'unixepoch') AS date,
        ROUND(SUM(s.total_cost_usd), 6) AS cost_usd,
        SUM(COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0)) AS total_tokens,
        SUM(COALESCE(e.done_count, 0)) AS tool_calls
      FROM sessions s
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS done_count
        FROM events WHERE type = 'Done'
        GROUP BY session_id
      ) e ON e.session_id = s.id
      WHERE s.started_at >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(since) as DailyActivity[]
  },

  getToolSparklines(tools: string[], days: number): Record<string, { day: string; calls: number; cost: number }[]> {
    const since = Date.now() - days * 86_400_000
    const stmt = db.prepare(`
      SELECT date(ts/1000,'unixepoch') as day, COUNT(*) as calls, 0 as cost
      FROM events WHERE tool_name = ? AND ts >= ? AND type = 'Done' GROUP BY day ORDER BY day
    `)
    const result: Record<string, { day: string; calls: number; cost: number }[]> = {}
    for (const tool of tools) {
      result[tool] = stmt.all(tool, since) as { day: string; calls: number; cost: number }[]
    }
    return result
  },

  getDbStats(): { sizeKb: number; oldestEventAt: number | null; totalEvents: number } {
    let sizeKb = 0
    try { sizeKb = Math.round(fs.statSync(DB_PATH).size / 1024) } catch {}
    const oldest = db.prepare('SELECT MIN(ts) as v FROM events').get() as any
    const total = db.prepare('SELECT COUNT(*) as v FROM events').get() as any
    return {
      sizeKb,
      oldestEventAt: oldest?.v ?? null,
      totalEvents: total?.v ?? 0,
    }
  },

  getDailySummary(): DailySummary {
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    const todayStart = todayMidnight.getTime()
    const yesterdayStart = todayStart - 86_400_000

    const todayRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost_usd),0) as cost,
             COUNT(*) as sessions,
             COALESCE(SUM(total_input_tokens + total_output_tokens),0) as tokens
      FROM sessions WHERE started_at >= ?
    `).get(todayStart) as { cost: number; sessions: number; tokens: number }

    const yesterdayRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost_usd),0) as cost, COUNT(*) as sessions
      FROM sessions WHERE started_at >= ? AND started_at < ?
    `).get(yesterdayStart, todayStart) as { cost: number; sessions: number }

    const topToolRow = db.prepare(`
      SELECT tool_name, COUNT(*) as cnt
      FROM events WHERE type = 'Done' AND ts >= ? AND tool_name IS NOT NULL
      GROUP BY tool_name ORDER BY cnt DESC LIMIT 1
    `).get(todayStart) as { tool_name: string; cnt: number } | undefined

    const totalDoneToday = (db.prepare(`
      SELECT COUNT(*) as cnt FROM events WHERE type = 'Done' AND ts >= ?
    `).get(todayStart) as { cnt: number }).cnt

    const sevenDayRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost_usd),0) as cost
      FROM sessions WHERE started_at >= ? AND started_at < ?
    `).get(todayStart - 7 * 86_400_000, todayStart) as { cost: number }

    const weekDayOfWeek = new Date(todayStart).getDay()
    const daysFromMonday = (weekDayOfWeek + 6) % 7
    const weekStart = todayStart - daysFromMonday * 86_400_000
    const weekCostRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost_usd),0) as cost FROM sessions WHERE started_at >= ?
    `).get(weekStart) as { cost: number }

    const daysElapsed = Math.max(1, daysFromMonday + 1)
    const avg7d = sevenDayRow.cost / 7

    return {
      today_cost: todayRow.cost,
      today_sessions: todayRow.sessions,
      today_tokens: todayRow.tokens,
      today_top_tool: topToolRow?.tool_name ?? '',
      today_top_tool_pct: topToolRow && totalDoneToday > 0
        ? Math.round(topToolRow.cnt / totalDoneToday * 100)
        : 0,
      vs_yesterday_cost_pct: yesterdayRow.cost > 0
        ? Math.round((todayRow.cost - yesterdayRow.cost) / yesterdayRow.cost * 100)
        : null,
      vs_yesterday_sessions_delta: todayRow.sessions - yesterdayRow.sessions,
      vs_7d_avg_cost_pct: avg7d > 0
        ? Math.round((todayRow.cost - avg7d) / avg7d * 100)
        : null,
      weekly_pace_cost: (weekCostRow.cost / daysElapsed) * 7,
    }
  },

  upsertOrchRun(row: Omit<OrchRunRow, 'id'>): void {
    stmts.upsertOrchRun.run(row)
  },

  getOrchRuns(projectPath: string): OrchRunRow[] {
    return stmts.getOrchRuns.all(projectPath) as OrchRunRow[]
  },

  getOrchRun(runKey: string): OrchRunRow | undefined {
    return stmts.getOrchRun.get(runKey) as OrchRunRow | undefined
  },
  upsertOrchCycleTrace(runKey: string, cycleIndex: number, traceJson: string): void {
    stmts.upsertOrchCycleTrace.run(runKey, cycleIndex, traceJson)
  },
  getOrchCycleTrace(runKey: string, cycleIndex: number): string | null {
    const row = stmts.getOrchCycleTrace.get(runKey, cycleIndex) as { trace_json: string } | undefined
    return row?.trace_json ?? null
  },

  getOrchAggregates(projectPath: string): { avg_cost_per_cycle: number; avg_duration_secs: number; avg_error_rate: number; avg_verify_pass_rate: number; total_runs: number } {
    try {
      const row = stmts.getOrchAggregates.get(projectPath) as any
      return row ?? { avg_cost_per_cycle: 0, avg_duration_secs: 0, avg_error_rate: 0, avg_verify_pass_rate: 0, total_runs: 0 }
    } catch {
      return { avg_cost_per_cycle: 0, avg_duration_secs: 0, avg_error_rate: 0, avg_verify_pass_rate: 0, total_runs: 0 }
    }
  },
}
