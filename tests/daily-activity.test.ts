import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'

test('getDailyActivity: returns an array', () => {
  const result = dbOps.getDailyActivity(7)
  assert.ok(Array.isArray(result))
})

test('getDailyActivity: items have required shape', () => {
  const result = dbOps.getDailyActivity(365)
  for (const item of result) {
    assert.ok(typeof item.date === 'string', 'date is string')
    assert.ok(typeof item.cost_usd === 'number', 'cost_usd is number')
    assert.ok(typeof item.total_tokens === 'number', 'total_tokens is number')
    assert.ok(typeof item.tool_calls === 'number', 'tool_calls is number')
  }
})

test('getDailyActivity: date format is YYYY-MM-DD', () => {
  const result = dbOps.getDailyActivity(365)
  for (const item of result) {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/)
  }
})
