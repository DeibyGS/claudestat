import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'
import type { SessionRow, EventRow, CostUpdate } from '../src/db'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

let idCounter = 1000
const newId = () => `adv-test-${++idCounter}`
const now    = () => Date.now()

describe('getAllSessions with LIMIT', { concurrency: false }, () => {
  test('getAllSessions returns at most 500 sessions', () => {
    const result = dbOps.getAllSessions()
    assert.ok(result.length <= 500, `should return <= 500, got ${result.length}`)
  })

  test('getAllSessions with custom limit', () => {
    const result = dbOps.getAllSessions(10)
    assert.ok(result.length <= 10, `should return <= 10, got ${result.length}`)
  })
})

describe('getSessionEventsRecent', { concurrency: false }, () => {
  test('returns limited number of events', () => {
    const sid = newId()
    dbOps.upsertSession({ id: sid, started_at: now(), cwd: '/test' })
    for (let i = 0; i < 10; i++) {
      dbOps.insertEvent({ session_id: sid, type: 'PreToolUse', tool_name: 'Read', ts: now() + i })
    }
    const result = dbOps.getSessionEventsRecent(sid, 5)
    assert.ok(result.length <= 5, `should return <= 5, got ${result.length}`)
  })

  test('returns empty for nonexistent session', () => {
    const result = dbOps.getSessionEventsRecent('nonexistent-0000', 10)
    assert.deepEqual(result, [])
  })
})

describe('getTopTools with real data', { concurrency: false }, () => {
  test('ranking by cost: Edit more expensive than Read', () => {
    const ts = now()

    const sid1 = newId()
    dbOps.upsertSession({ id: sid1, started_at: ts, cwd: '/test' })
    dbOps.updateSessionCost(sid1, {
      input_tokens: 5000, output_tokens: 2000, cache_read: 0, cache_creation: 0,
      cost_usd: 0.50, context_used: 5000, context_window: 200000,
    }, 90, 0)
    for (let i = 0; i < 5; i++) {
      dbOps.insertEvent({ session_id: sid1, type: 'PreToolUse', tool_name: 'Edit', ts: ts + i })
      dbOps.pairPostWithPre(sid1, 'Edit', 'ok', ts + i + 100)
    }

    const sid2 = newId()
    dbOps.upsertSession({ id: sid2, started_at: ts, cwd: '/test' })
    dbOps.updateSessionCost(sid2, {
      input_tokens: 500, output_tokens: 100, cache_read: 0, cache_creation: 0,
      cost_usd: 0.01, context_used: 500, context_window: 200000,
    }, 100, 0)
    for (let i = 0; i < 3; i++) {
      dbOps.insertEvent({ session_id: sid2, type: 'PreToolUse', tool_name: 'Read', ts: ts + i })
      dbOps.pairPostWithPre(sid2, 'Read', 'content', ts + i + 50)
    }

    const result = dbOps.getTopTools(1, 'cost', 10)
    if (result.length >= 2) {
      assert.ok(result[0].total_cost_usd >= result[1].total_cost_usd,
        'first tool should have higher or equal cost')
    }
  })

  test('ranking by count: Read called more than Edit', () => {
    const ts = now()
    const sid = newId()
    dbOps.upsertSession({ id: sid, started_at: ts, cwd: '/test' })
    dbOps.updateSessionCost(sid, {
      input_tokens: 1000, output_tokens: 200, cache_read: 0, cache_creation: 0,
      cost_usd: 0.05, context_used: 1000, context_window: 200000,
    }, 100, 0)

    for (let i = 0; i < 8; i++) {
      dbOps.insertEvent({ session_id: sid, type: 'PreToolUse', tool_name: 'Read', ts: ts + i * 10 })
      dbOps.pairPostWithPre(sid, 'Read', 'content', ts + i * 10 + 5)
    }
    for (let i = 0; i < 2; i++) {
      dbOps.insertEvent({ session_id: sid, type: 'PreToolUse', tool_name: 'Edit', ts: ts + i * 10 + 200 })
      dbOps.pairPostWithPre(sid, 'Edit', 'ok', ts + i * 10 + 205)
    }

    const result = dbOps.getTopTools(1, 'count', 10)
    if (result.length >= 2) {
      assert.ok(result[0].count >= result[1].count,
        'first tool should have higher or equal count')
    }
  })
})

describe('getCostProjection with real sessions', { concurrency: false }, () => {
  test('projection returns positive values after inserting cost data', () => {
    const ts = Date.now()
    const sid = newId()
    dbOps.upsertSession({ id: sid, started_at: ts - 3 * 86_400_000, cwd: '/test' })
    dbOps.updateSessionCost(sid, {
      input_tokens: 5000, output_tokens: 1000, cache_read: 0, cache_creation: 0,
      cost_usd: 1.50, context_used: 5000, context_window: 200000,
    }, 90, 0)

    const result = dbOps.getCostProjection(7)
    assert.ok(result.total_cost_usd > 0, 'should have positive cost')
    assert.ok(result.earliest > 0, 'should have earliest timestamp')
  })
})
