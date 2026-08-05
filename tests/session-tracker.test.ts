import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionTracker } from '../src/session-tracker'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

function makeTracker(onClosed: (id: string) => void) {
  const closed: string[] = []
  const tracker = createSessionTracker({
    onSessionClosed: (id) => { closed.push(id); onClosed?.(id) },
  })
  return { tracker, closed }
}

describe('createSessionTracker', () => {
  test('observe misma sesión 2 veces → no notifica', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('claude-code', 'A')
    assert.deepEqual(closed, [])
  })

  test('observe sesión nueva del mismo source → notifica la anterior exactamente 1 vez', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('claude-code', 'B')
    assert.deepEqual(closed, ['A'])
    assert.equal(tracker.activeOf?.('claude-code'), 'B')
  })

  test('subagente agent-* no altera el activo ni notifica', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'main-1')
    tracker.observe('claude-code', 'agent-abc')
    tracker.observe('claude-code', 'agent-def')
    assert.deepEqual(closed, [])
    assert.equal(tracker.activeOf?.('claude-code'), 'main-1')
  })

  test('reemplazo en cadena A→B→C → notifica solo B al llegar C (A ya notificada)', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('claude-code', 'B')   // notifica A
    tracker.observe('claude-code', 'C')   // notifica B
    assert.deepEqual(closed, ['A', 'B'])
    assert.equal(tracker.activeOf?.('claude-code'), 'C')
  })

  test('flushPending con sesión activa sin reemplazo → notifica la activa', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.flushPending()
    assert.deepEqual(closed, ['A'])
  })

  test('flushPending cuando la activa ya fue notificada → no notifica de nuevo', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('claude-code', 'B')   // notifica A
    tracker.flushPending()                 // B es activa y no notificada → notifica B
    tracker.flushPending()                 // B ya notificada → no hace nada
    assert.deepEqual(closed, ['A', 'B'])
  })

  test('sources distintos → trackers independientes', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('claude-code', 'B')   // notifica A
    tracker.observe('opencode', 'C')      // no relacionado con claude-code
    assert.deepEqual(closed, ['A'])
    assert.equal(tracker.activeOf?.('claude-code'), 'B')
    assert.equal(tracker.activeOf?.('opencode'), 'C')
  })

  test('flushPending con source específico → solo afecta ese source', () => {
    const { tracker, closed } = makeTracker()
    tracker.observe('claude-code', 'A')
    tracker.observe('opencode', 'X')
    tracker.flushPending('claude-code')
    assert.deepEqual(closed, ['A'])
    assert.equal(tracker.activeOf?.('opencode'), 'X')
  })
})