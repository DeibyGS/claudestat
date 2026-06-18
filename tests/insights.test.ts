import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateTip, renderWeeklyInsight } from '../src/insights'
import type { WeeklyInsightData } from '../src/insights'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

const BASE: WeeklyInsightData = {
  total_sessions: 10,
  total_cost: 5,
  input_tokens: 50000,
  output_tokens: 20000,
  cache_read: 30000,
  cache_hit_pct: 43,
  total_loops: 0,
  avg_efficiency: 80,
  top_tool: 'Read',
  top_tool_cost_pct: 25,
  week_start: Date.now() - 3 * 86400000,
  week_end: Date.now(),
}

describe('generateTip', () => {
  test('Bash >= 40% cost → bash grouping tip', () => {
    const d: WeeklyInsightData = { ...BASE, top_tool: 'Bash', top_tool_cost_pct: 45 }
    const tip = generateTip(d)
    assert.match(tip, /Group bash commands/i)
  })

  test('total_loops >= 3 → compaction tip', () => {
    const d: WeeklyInsightData = { ...BASE, total_loops: 5 }
    const tip = generateTip(d)
    assert.match(tip, /compaction|compact/i)
    assert.match(tip, /loops/)
  })

  test('avg_efficiency < 60 → efficiency tip', () => {
    const d: WeeklyInsightData = { ...BASE, avg_efficiency: 45 }
    const tip = generateTip(d)
    assert.match(tip, /efficiency/i)
    assert.match(tip, /smaller|focused/i)
  })

  test('total_sessions > 30 → batching tip', () => {
    const d: WeeklyInsightData = { ...BASE, total_sessions: 47 }
    const tip = generateTip(d)
    assert.match(tip, /batch/i)
    assert.match(tip, /sessions/)
  })

  test('cache_hit_pct < 10 + sessions > 5 → cache tip', () => {
    const d: WeeklyInsightData = { ...BASE, cache_hit_pct: 5, total_sessions: 12 }
    const tip = generateTip(d)
    assert.match(tip, /cache/i)
    assert.match(tip, /CLAUDE\.md/i)
  })

  test('cache_hit_pct < 10 but <= 5 sessions → no cache tip (falls through)', () => {
    const d: WeeklyInsightData = { ...BASE, cache_hit_pct: 5, total_sessions: 3 }
    const tip = generateTip(d)
    assert.doesNotMatch(tip, /cache/i)
  })

  test('total_cost > 20 → alerts tip', () => {
    const d: WeeklyInsightData = { ...BASE, total_cost: 45 }
    const tip = generateTip(d)
    assert.match(tip, /alerts/i)
    assert.match(tip, /config/i)
  })

  test('no pattern triggered → default tip', () => {
    const tip = generateTip(BASE)
    assert.match(tip, /quota alerts/i)
    assert.match(tip, /config --alerts/i)
  })
})

describe('renderWeeklyInsight', () => {
  test('contains expected sections', () => {
    const out = renderWeeklyInsight({
      ...BASE,
      top_tool: 'Bash',
      top_tool_cost_pct: 50,
      total_loops: 4,
    })

    assert.match(out, /claudestat weekly/i)
    assert.match(out, /sessions/i)
    assert.match(out, /total/i)
    assert.match(out, /loops/i)
    assert.match(out, /Top tool/i)
    assert.match(out, /Efficiency/i)
    assert.match(out, /Tip:/i)
  })
})
