// IMPORTANT: env vars must be set before db module loads (module-level side effects)
// These are passed via the npm test script: CLAUDESTAT_DB_PATH=:memory: CLAUDESTAT_DATA_DIR=/tmp

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'
import type { SessionRow, EventRow, CostUpdate } from '../src/db'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
const newId = () => `test-session-${++idCounter}`
const now    = () => Date.now()

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return { id: newId(), started_at: now(), cwd: '/test', ...overrides }
}

function makeCostUpdate(overrides: Partial<CostUpdate> = {}): CostUpdate {
  return {
    input_tokens:   1000,
    output_tokens:  200,
    cache_read:     500,
    cache_creation: 100,
    cost_usd:       0.05,
    context_used:   1500,
    context_window: 200_000,
    lastModel:      'claude-sonnet-4-6',
    ...overrides,
  }
}

// ─── upsertSession / getSession ───────────────────────────────────────────────

test('upsertSession creates a new session and getSession retrieves it', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  const row = dbOps.getSession(s.id)
  assert.ok(row, 'session should exist')
  assert.equal(row!.id, s.id)
  assert.equal(row!.cwd, '/test')
})

test('upsertSession with same id updates last_event_at only', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  const laterTs = s.started_at + 5000
  dbOps.upsertSession({ ...s, last_event_at: laterTs })
  const row = dbOps.getSession(s.id)
  assert.equal(row!.last_event_at, laterTs)
})

test('getSession returns undefined for unknown id', () => {
  const row = dbOps.getSession('nonexistent-id')
  assert.equal(row, undefined)
})

// ─── insertEvent / getSessionEvents ──────────────────────────────────────────

test('insertEvent stores event and getSessionEvents returns it', () => {
  const s = makeSession()
  dbOps.upsertSession(s)

  const e: EventRow = { session_id: s.id, type: 'PreToolUse', tool_name: 'Read', ts: now(), cwd: '/test' }
  const eventId = dbOps.insertEvent(e)
  assert.ok(eventId > 0, 'insertEvent should return a positive id')

  const events = dbOps.getSessionEvents(s.id)
  assert.equal(events.length, 1)
  assert.equal(events[0].tool_name, 'Read')
  assert.equal(events[0].type, 'PreToolUse')
})

test('getSessionEvents returns empty array for session with no events', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  const events = dbOps.getSessionEvents(s.id)
  assert.deepEqual(events, [])
})

test('insertEvent stores skill_parent field', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  dbOps.insertEvent({ session_id: s.id, type: 'PreToolUse', tool_name: 'Bash', ts: now(), skill_parent: 'simplify' })
  const events = dbOps.getSessionEvents(s.id)
  assert.equal(events[0].skill_parent, 'simplify')
})

// ─── pairPostWithPre ──────────────────────────────────────────────────────────

test('pairPostWithPre converts PreToolUse into Done with duration_ms', () => {
  const s = makeSession()
  dbOps.upsertSession(s)

  const preTs = now()
  dbOps.insertEvent({ session_id: s.id, type: 'PreToolUse', tool_name: 'Edit', ts: preTs })

  const postTs = preTs + 300
  const pairedId = dbOps.pairPostWithPre(s.id, 'Edit', 'ok', postTs)
  assert.ok(pairedId !== null, 'should find and pair the PreToolUse')

  const events = dbOps.getSessionEvents(s.id)
  assert.equal(events[0].type, 'Done')
  assert.equal(events[0].duration_ms, 300)
  assert.equal(events[0].tool_response, 'ok')
})

test('pairPostWithPre returns null when no matching PreToolUse exists', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  const result = dbOps.pairPostWithPre(s.id, 'Read', 'content', now())
  assert.equal(result, null)
})

// ─── updateSessionCost ────────────────────────────────────────────────────────

test('updateSessionCost updates all cost fields', () => {
  const s = makeSession()
  dbOps.upsertSession(s)

  const cost = makeCostUpdate({ cost_usd: 0.25, input_tokens: 2000, cache_read: 800 })
  dbOps.updateSessionCost(s.id, cost, 90, 1)

  const row = dbOps.getSession(s.id)
  assert.equal(row!.total_cost_usd,       0.25)
  assert.equal(row!.total_input_tokens,   2000)
  assert.equal(row!.total_cache_read,     800)
  assert.equal(row!.efficiency_score,     90)
  assert.equal(row!.loops_detected,       1)
})

// ─── updateSessionProject ─────────────────────────────────────────────────────

test('updateSessionProject sets project_path when null', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  dbOps.updateSessionProject(s.id, '/Users/db/myproject')
  const row = dbOps.getSession(s.id)
  assert.equal(row!.project_path, '/Users/db/myproject')
})

test('updateSessionProject does not overwrite existing project_path', () => {
  const s = makeSession()
  dbOps.upsertSession(s)
  dbOps.updateSessionProject(s.id, '/first/path')
  dbOps.updateSessionProject(s.id, '/second/path')  // should be ignored
  const row = dbOps.getSession(s.id)
  assert.equal(row!.project_path, '/first/path')
})

// ─── getModeDistribution ──────────────────────────────────────────────────────

test('getModeDistribution classifies sessions: direct (0 agents), mini (1–6), pipeline (7+)', () => {
  const ts = now()

  // direct — no Agent events
  const direct = makeSession({ started_at: ts })
  dbOps.upsertSession(direct)

  // mini — 3 Agent events
  const mini = makeSession({ started_at: ts })
  dbOps.upsertSession(mini)
  for (let i = 0; i < 3; i++) {
    dbOps.insertEvent({ session_id: mini.id, type: 'Done', tool_name: 'Agent', ts: ts + i })
  }

  // pipeline — 8 Agent events
  const pipeline = makeSession({ started_at: ts })
  dbOps.upsertSession(pipeline)
  for (let i = 0; i < 8; i++) {
    dbOps.insertEvent({ session_id: pipeline.id, type: 'Done', tool_name: 'Agent', ts: ts + i })
  }

  const dist = dbOps.getModeDistribution(1)
  assert.ok(dist.direct   >= 1, `direct should be >= 1, got ${dist.direct}`)
  assert.ok(dist.mini     >= 1, `mini should be >= 1, got ${dist.mini}`)
  assert.ok(dist.pipeline >= 1, `pipeline should be >= 1, got ${dist.pipeline}`)
  assert.equal(dist.total, dist.direct + dist.mini + dist.pipeline)
})

// ─── getHiddenCostStats ───────────────────────────────────────────────────────

test('getHiddenCostStats: session with 0 loops does not increase loop_waste_usd', () => {
  const before = dbOps.getHiddenCostStats(1)

  const s = makeSession()
  dbOps.upsertSession(s)
  dbOps.updateSessionCost(s.id, makeCostUpdate({ cost_usd: 1.00 }), 100, 0)  // 0 loops

  const after = dbOps.getHiddenCostStats(1)
  assert.equal(after.loop_waste_usd,  before.loop_waste_usd)   // waste unchanged
  assert.equal(after.total_sessions,  before.total_sessions + 1)
  assert.equal(after.loop_sessions,   before.loop_sessions)     // no new loop session
})

test('getHiddenCostStats computes loop_waste_usd proportional to loops/done_count', () => {
  const s = makeSession()
  dbOps.upsertSession(s)

  // 10 Done events in session
  for (let i = 0; i < 10; i++) {
    dbOps.insertEvent({ session_id: s.id, type: 'Done', tool_name: 'Read', ts: now() + i })
  }
  // cost=$1.00, loops=5 → waste = 1.00 * (5/10) = $0.50
  dbOps.updateSessionCost(s.id, makeCostUpdate({ cost_usd: 1.00 }), 80, 5)

  const stats = dbOps.getHiddenCostStats(1)
  assert.ok(stats.loop_waste_usd > 0, 'loop_waste_usd should be > 0')
  assert.ok(stats.loop_sessions  >= 1)
  assert.ok(stats.total_loops    >= 5)
})

// ─── Weekly reports ───────────────────────────────────────────────────────────

test('insertWeeklyReport stores and getWeeklyReportByDate retrieves it', () => {
  const date = '2026-04-28'
  dbOps.insertWeeklyReport(date, '## Weekly Report\nContent here.')
  const row = dbOps.getWeeklyReportByDate(date)
  assert.ok(row, 'report should exist')
  assert.equal(row!.date, date)
  assert.ok(row!.report_markdown.includes('Weekly Report'))
})

test('insertWeeklyReport upserts on conflict (same date overwrites)', () => {
  const date = '2026-04-29'
  dbOps.insertWeeklyReport(date, 'original')
  dbOps.insertWeeklyReport(date, 'updated')
  const row = dbOps.getWeeklyReportByDate(date)
  assert.equal(row!.report_markdown, 'updated')
})

test('getWeeklyReportByDate returns undefined for missing date', () => {
  const row = dbOps.getWeeklyReportByDate('1900-01-01')
  assert.equal(row, undefined)
})

test('listWeeklyReports returns inserted reports in DESC order', () => {
  dbOps.insertWeeklyReport('2026-05-01', 'report A')
  dbOps.insertWeeklyReport('2026-05-02', 'report B')
  const list = dbOps.listWeeklyReports()
  assert.ok(list.length >= 2)
  // Verify DESC order: later date comes first
  const idx1 = list.findIndex(r => r.date === '2026-05-02')
  const idx2 = list.findIndex(r => r.date === '2026-05-01')
  assert.ok(idx1 < idx2, 'later date should appear first')
})
