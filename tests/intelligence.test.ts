import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSession } from '../src/intelligence'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

function makeEvent(overrides: Record<string, any> = {}): any {
  return { type: 'Done', tool_name: 'Read', ts: Date.now(), duration_ms: 100, ...overrides }
}

describe('analyzeSession', () => {
  test('efficiencyScore >= 90 with 0 loops and few tool calls', () => {
    const events = [makeEvent(), makeEvent({ tool_name: 'Edit' })]
    const result = analyzeSession(events, 0.01)
    assert.ok(result.efficiencyScore >= 90, `score should be >= 90, got ${result.efficiencyScore}`)
  })

  test('efficiencyScore drops with high cost', () => {
    const events: any[] = []
    for (let i = 0; i < 10; i++) events.push(makeEvent({ tool_name: 'Bash', ts: Date.now() + i * 100 }))
    const result = analyzeSession(events, 15.00)
    assert.ok(result.efficiencyScore < 90, `score should be < 90 with $15 cost, got ${result.efficiencyScore}`)
  })

  test('loop detected when same tool called 8+ times within window', () => {
    const events: any[] = []
    const base = Date.now()
    for (let i = 0; i < 10; i++) {
      events.push({ type: 'Done', tool_name: 'Bash', ts: base + i * 5000, duration_ms: 100 })
    }
    const result = analyzeSession(events, 0.50)
    assert.ok(result.loops.length > 0, 'should detect loops')
    assert.ok(result.loops.some(l => l.toolName === 'Bash'), 'Bash should appear in loops')
  })

  test('summary uses English labels', () => {
    const events = [makeEvent(), makeEvent({ tool_name: 'Edit' })]
    const result = analyzeSession(events, 0.01)
    assert.ok(!result.summary.includes('Sesión') && !result.summary.includes('Detectado'),
      `summary should be in English, got: ${result.summary}`)
    assert.ok(result.summary.includes('Efficient') || result.summary.includes('tool calls'),
      `summary should contain English text, got: ${result.summary}`)
  })

  test('empty events returns efficiencyScore 100', () => {
    const result = analyzeSession([], 0)
    assert.equal(result.efficiencyScore, 100)
    assert.equal(result.loops.length, 0)
  })
})
