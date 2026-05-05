import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSessionState } from '../src/session-state'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

describe('deriveSessionState', () => {
  test('PreToolUse → working', () => {
    const now = Date.now()
    assert.equal(deriveSessionState('PreToolUse', now), 'working')
  })

  test('PostToolUse → working', () => {
    const now = Date.now()
    assert.equal(deriveSessionState('PostToolUse', now), 'working')
  })

  test('Stop → waiting_for_input', () => {
    const now = Date.now()
    assert.equal(deriveSessionState('Stop', now), 'waiting_for_input')
  })

  test('SessionStart → waiting_for_input', () => {
    const now = Date.now()
    assert.equal(deriveSessionState('SessionStart', now), 'waiting_for_input')
  })

  test('idle after >5 minutes of inactivity', () => {
    const oldTs = Date.now() - 6 * 60_000
    assert.equal(deriveSessionState('PreToolUse', oldTs), 'idle')
  })

  test('unknown event type → waiting_for_input', () => {
    const now = Date.now()
    assert.equal(deriveSessionState('SomeUnknownType', now), 'waiting_for_input')
  })

  test('undefined event type → waiting_for_input', () => {
    const now = Date.now()
    assert.equal(deriveSessionState(undefined, now), 'waiting_for_input')
  })
})
