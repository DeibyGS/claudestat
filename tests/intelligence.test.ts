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
    const result = analyzeSession(events, 35.00)
    assert.ok(result.efficiencyScore < 90, `score should be < 90 with $35 cost, got ${result.efficiencyScore}`)
  })

  test('loop detected when same tool called 8+ times within window', () => {
    const events: any[] = []
    const base = Date.now()
    for (let i = 0; i < 10; i++) {
      events.push({ type: 'Done', tool_name: 'Bash', ts: base + i * 5000, duration_ms: 100, tool_input: '{"command":"npm test"}' })
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

  test('detectLoops respects custom threshold', () => {
    const events: any[] = []
    const base = Date.now()
    // 5 calls within window — below default threshold (8) but above custom (3)
    for (let i = 0; i < 5; i++) {
      events.push({ type: 'Done', tool_name: 'Read', ts: base + i * 5000, duration_ms: 100, tool_input: '{"file_path":"/a.ts"}' })
    }
    // With custom threshold=3, should detect loop
    const resultLow = analyzeSession(events, 0.10, 3, 120_000)
    assert.ok(resultLow.loops.length > 0, 'should detect with threshold=3')

    // With default threshold=8, should NOT detect loop (only 5 calls)
    const resultHigh = analyzeSession(events, 0.10, 8, 120_000)
    assert.equal(resultHigh.loops.length, 0, 'should not detect with threshold=8')
  })

  test('loop alert has context field', () => {
    const events: any[] = []
    const base = Date.now()
    for (let i = 0; i < 10; i++) {
      events.push({
        type: 'Done',
        tool_name: 'Read',
        ts: base + i * 5000,
        duration_ms: 100,
        tool_input: JSON.stringify({ file_path: `/path/to/file${i % 3}.ts` }),
      })
    }
    const result = analyzeSession(events, 0.50)
    assert.ok(result.loops.length > 0, 'should detect loops')
    const loop = result.loops[0]
    assert.ok('context' in loop, 'loop should have context field')
    assert.ok(Array.isArray(loop.context.repeatedFiles), 'context.repeatedFiles should be array')
    assert.ok(Array.isArray(loop.context.repeatedCommands), 'context.repeatedCommands should be array')
    assert.ok(typeof loop.context.estimatedCostUsd === 'number', 'context.estimatedCostUsd should be number')
  })
})

// ─── S7: loop detection flags real repetition, not normal bursts ─────────────

describe('S7 loop detection', () => {
  const base = 1_700_000_000_000
  const bash = (command: string, ts: number, type = 'Done', extra: Record<string, any> = {}): any =>
    ({ type, tool_name: 'Bash', ts, tool_input: JSON.stringify({ command, ...extra }) })

  test('same tool + same normalized input 3 times within 10 min → one alert with tool, input and count', () => {
    const events = [
      bash('npm test', base),
      bash('npm   test ', base + 3 * 60_000, 'Done', { description: 'run tests' }),
      bash('npm test', base + 6 * 60_000),
    ]
    const { loops } = analyzeSession(events, 0)
    assert.equal(loops.length, 1)
    assert.equal(loops[0].toolName, 'Bash')
    assert.equal(loops[0].count, 3)
    assert.match(loops[0].input, /npm test/)
  })

  test('a 4th identical call extends the same alert instead of raising another', () => {
    const events = [0, 1, 2, 3].map(i => bash('npm test', base + i * 60_000))
    const { loops } = analyzeSession(events, 0)
    assert.equal(loops.length, 1)
    assert.equal(loops[0].count, 4)
  })

  test('3 identical calls spread over more than 10 min → no alert', () => {
    const events = [0, 6, 12].map(m => bash('npm test', base + m * 60_000))
    assert.equal(analyzeSession(events, 0).loops.length, 0)
  })

  test('8 Bash calls with 8 different commands within 2 min → no alert', () => {
    const events = Array.from({ length: 8 }, (_, i) => bash(`ls dir${i}`, base + i * 15_000))
    assert.equal(analyzeSession(events, 0).loops.length, 0)
  })

  test('only Done counts: Pre + Done pairs of 2 calls do not reach 3', () => {
    const events = [
      bash('npm test', base, 'PreToolUse'), bash('npm test', base + 1_000),
      bash('npm test', base + 60_000, 'PreToolUse'), bash('npm test', base + 61_000),
    ]
    assert.equal(analyzeSession(events, 0).loops.length, 0)
  })

  test('3 consecutive tool results with the same error → error_persistence alert', () => {
    const err = 'Error: Cannot find module "foo"'
    const events = [0, 1, 2].map(i => ({ ...bash(`node run${i}.js`, base + i * 10_000), tool_response: err }))
    const { errorPersistence } = analyzeSession(events, 0)
    assert.equal(errorPersistence.length, 1)
    assert.equal(errorPersistence[0].type, 'error_persistence')
    assert.equal(errorPersistence[0].count, 3)
    assert.match(errorPersistence[0].error, /Cannot find module/)
  })

  test('3 errors that differ, or a success in between → no error_persistence', () => {
    const differ = ['Error: a', 'Error: b', 'Error: c']
      .map((r, i) => ({ ...bash(`x${i}`, base + i * 1_000), tool_response: r }))
    assert.equal(analyzeSession(differ, 0).errorPersistence.length, 0)

    const broken = ['Error: a', 'ok', 'Error: a', 'Error: a']
      .map((r, i) => ({ ...bash(`x${i}`, base + i * 1_000), tool_response: r }))
    assert.equal(analyzeSession(broken, 0).errorPersistence.length, 0)
  })

  test('calls without a recorded input (OpenCode events) are never a loop', () => {
    const events = [0, 1, 2, 3].map(i => ({ type: 'Done', tool_name: 'bash', ts: base + i * 1_000 }))
    assert.equal(analyzeSession(events as any, 0).loops.length, 0)
  })

  test('the same error with a different line number or duration still counts as one run', () => {
    const responses = [
      'Error: request timed out after 1203ms (pid 4411)',
      'Error: request timed out after 1450ms (pid 4502)',
      'Error: request timed out after 998ms (pid 4610)',
    ]
    const events = responses.map((r, i) => ({ ...bash('npx tsc', base + i * 1_000), tool_response: r }))
    assert.equal(analyzeSession(events, 0).errorPersistence.length, 1)
  })

  test('defaults come from config: 3 calls in 600 s, error run of 3', () => {
    const { DEFAULTS } = require('../src/config')
    assert.equal(DEFAULTS.loopThreshold, 3)
    assert.equal(DEFAULTS.loopWindowSecs, 600)
    assert.equal(DEFAULTS.errorRunThreshold, 3)
  })
})
