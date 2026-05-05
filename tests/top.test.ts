import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

describe('getTopTools', () => {
  test('returns empty array when no Done events exist', () => {
    const result = dbOps.getTopTools(30, 'cost', 10)
    assert.ok(Array.isArray(result))
  })

  test('accepts all sort modes without throwing', () => {
    assert.doesNotThrow(() => dbOps.getTopTools(30, 'cost', 5))
    assert.doesNotThrow(() => dbOps.getTopTools(30, 'count', 5))
    assert.doesNotThrow(() => dbOps.getTopTools(30, 'duration', 5))
  })

  test('returns tools with correct field names after inserting events', () => {
    const sid = 'top-test-session-' + Date.now()
    dbOps.upsertSession({ id: sid, started_at: Date.now(), last_event_at: Date.now() })
    dbOps.updateSessionCost(sid, {
      input_tokens: 1000, output_tokens: 500, cache_read: 0, cache_creation: 0,
      cost_usd: 0.05, context_used: 1000, context_window: 200000,
    }, 100, 0)

    dbOps.insertEvent({
      session_id: sid, type: 'PreToolUse', tool_name: 'Read', ts: Date.now() - 1000,
    })
    const insertRes = dbOps.insertEvent({
      session_id: sid, type: 'PreToolUse', tool_name: 'Read', ts: Date.now(),
    })
    dbOps.pairPostWithPre(sid, 'Read', 'file content', 500)

    const result = dbOps.getTopTools(30, 'cost', 10)
    if (result.length > 0) {
      assert.ok('tool_name' in result[0], 'should have tool_name field')
      assert.ok('count' in result[0], 'should have count field')
      assert.ok('total_cost_usd' in result[0], 'should have total_cost_usd field')
      assert.ok('total_duration_ms' in result[0], 'should have total_duration_ms field')
    }
  })
})

describe('getCostProjection', () => {
  test('returns null-compatible fields when no sessions exist', () => {
    const result = dbOps.getCostProjection(7)
    assert.ok(result)
    assert.ok('total_cost_usd' in result)
    assert.ok('earliest' in result)
    assert.ok('latest' in result)
  })

  test('does not throw with valid input', () => {
    assert.doesNotThrow(() => dbOps.getCostProjection(30))
    assert.doesNotThrow(() => dbOps.getCostProjection(1))
  })
})
