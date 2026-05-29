import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSemanticLoops, predictSaturation } from '../src/intelligence'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

function makeTurn(overrides: Partial<{ turn_index: number; tool_calls: string[]; error_count: number }> = {}) {
  return { turn_index: 0, tool_calls: [], error_count: 0, ...overrides }
}

describe('analyzeSemanticLoops', () => {
  test('returns empty array with no turns', () => {
    assert.deepEqual(analyzeSemanticLoops([]), [])
  })

  test('detects error_persistence: 3 consecutive error turns', () => {
    const turns = [
      makeTurn({ turn_index: 0, error_count: 1 }),
      makeTurn({ turn_index: 1, error_count: 1 }),
      makeTurn({ turn_index: 2, error_count: 1 }),
    ]
    const loops = analyzeSemanticLoops(turns)
    assert.equal(loops.length, 1)
    assert.equal(loops[0].type, 'error_persistence')
    assert.equal(loops[0].count, 3)
    assert.equal(loops[0].turn_start, 0)
  })

  test('does not flag error_persistence for only 2 error turns', () => {
    const turns = [
      makeTurn({ turn_index: 0, error_count: 1 }),
      makeTurn({ turn_index: 1, error_count: 1 }),
      makeTurn({ turn_index: 2, error_count: 0 }),
    ]
    const loops = analyzeSemanticLoops(turns)
    const errLoops = loops.filter(l => l.type === 'error_persistence')
    assert.equal(errLoops.length, 0)
  })

  test('detects tool_sequence: same tool_calls repeated', () => {
    const turns = [
      makeTurn({ turn_index: 0, tool_calls: ['Read', 'Edit'] }),
      makeTurn({ turn_index: 1, tool_calls: ['Bash'] }),
      makeTurn({ turn_index: 2, tool_calls: ['Read', 'Edit'] }),
    ]
    const loops = analyzeSemanticLoops(turns)
    const seqLoops = loops.filter(l => l.type === 'tool_sequence')
    assert.ok(seqLoops.length >= 1)
    assert.ok(seqLoops[0].detail.includes('Read→Edit'))
  })

  test('does not flag tool_sequence for turns with empty tool_calls', () => {
    const turns = [
      makeTurn({ turn_index: 0, tool_calls: [] }),
      makeTurn({ turn_index: 1, tool_calls: [] }),
      makeTurn({ turn_index: 2, tool_calls: [] }),
    ]
    const loops = analyzeSemanticLoops(turns)
    const seqLoops = loops.filter(l => l.type === 'tool_sequence')
    assert.equal(seqLoops.length, 0)
  })
})

describe('predictSaturation', () => {
  test('returns null with fewer than 3 samples', () => {
    const samples = [
      { ts: 0,    context_used: 10_000 },
      { ts: 60000, context_used: 20_000 },
    ]
    assert.equal(predictSaturation(samples, 200_000), null)
  })

  test('returns null for flat/decreasing trend', () => {
    const samples = [
      { ts: 0,     context_used: 50_000 },
      { ts: 60000, context_used: 40_000 },
      { ts: 120000, context_used: 30_000 },
    ]
    assert.equal(predictSaturation(samples, 200_000), null)
  })

  test('predicts minutes left for linear growth', () => {
    // 10k tokens/min, window 200k, target 90% = 180k
    // At t=2min context=20k, slope=10k/min → needs 16 more min to hit 180k
    const samples = [
      { ts: 0,     context_used: 0 },
      { ts: 60000,  context_used: 10_000 },
      { ts: 120000, context_used: 20_000 },
    ]
    const result = predictSaturation(samples, 200_000)
    assert.ok(result !== null)
    assert.ok(result.minutesLeft > 0)
    assert.ok(result.pctPerMin > 0)
  })

  test('returns null when already past 90% target', () => {
    const samples = [
      { ts: 0,     context_used: 150_000 },
      { ts: 60000,  context_used: 170_000 },
      { ts: 120000, context_used: 195_000 },
    ]
    assert.equal(predictSaturation(samples, 200_000), null)
  })
})
