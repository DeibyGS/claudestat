import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzePatterns } from '../src/pattern-analyzer'
import type { ToolCount, SessionStats } from '../src/pattern-analyzer'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseStats: SessionStats = {
  session_count:   5,
  avg_cache_read:  1_000,
  avg_total_input: 10_000,
  avg_loops:       0,
  avg_cost_usd:    0.10,
  avg_efficiency:  80,
}

/** Build a ToolCount array with named counts + filler to reach a total */
function tools(named: Record<string, number>, fillerTotal = 0): ToolCount[] {
  const result: ToolCount[] = Object.entries(named).map(([tool_name, count]) => ({ tool_name, count }))
  const namedTotal = result.reduce((s, t) => s + t.count, 0)
  if (fillerTotal > namedTotal) result.push({ tool_name: 'Edit', count: fillerTotal - namedTotal })
  return result
}

const stats = (overrides: Partial<SessionStats>): SessionStats => ({ ...baseStats, ...overrides })

// ─── Guard conditions ─────────────────────────────────────────────────────────

test('returns empty when session_count < MIN_SESSIONS (2)', () => {
  const result = analyzePatterns(tools({ Read: 30 }, 60), stats({ session_count: 1 }))
  assert.deepEqual(result, [])
})

test('returns empty when total tools < MIN_TOOLS (15)', () => {
  const result = analyzePatterns(tools({ Read: 7 }, 14), baseStats)
  assert.deepEqual(result, [])
})

test('returns empty when both guards fail', () => {
  const result = analyzePatterns([], stats({ session_count: 0 }))
  assert.deepEqual(result, [])
})

// ─── Read dominance ───────────────────────────────────────────────────────────

test('detects Read dominance when readPct >= 45 and readCount >= 20', () => {
  // 25 Read / 50 total = 50% >= 45%
  const result = analyzePatterns(tools({ Read: 25 }, 50), baseStats)
  const found = result.find(i => i.title === 'High Read frequency')
  assert.ok(found, 'should detect Read dominance')
  assert.equal(found!.level, 'tip')
})

test('no Read dominance when readPct < 45', () => {
  // 10 Read / 50 total = 20%
  const result = analyzePatterns(tools({ Read: 10 }, 50), baseStats)
  assert.ok(!result.find(i => i.title === 'High Read frequency'))
})

test('no Read dominance when readCount < 20 even if pct is high', () => {
  // 9 Read / 15 total = 60% but count < 20
  const result = analyzePatterns(tools({ Read: 9 }, 15), baseStats)
  assert.ok(!result.find(i => i.title === 'High Read frequency'))
})

// ─── Bash overuse ─────────────────────────────────────────────────────────────

test('detects Bash overuse when bash > read+grep+glob and bash >= 10', () => {
  // Bash=15, Read+Grep+Glob=5
  const result = analyzePatterns(tools({ Bash: 15, Read: 3, Grep: 2 }, 30), baseStats)
  const found = result.find(i => i.title === 'Bash used more than Read/Grep')
  assert.ok(found, 'should detect Bash overuse')
  assert.equal(found!.level, 'tip')
})

test('no Bash overuse when bash <= read+grep+glob', () => {
  const result = analyzePatterns(tools({ Bash: 10, Read: 8, Grep: 5 }, 30), baseStats)
  assert.ok(!result.find(i => i.title === 'Bash used more than Read/Grep'))
})

test('no Bash overuse when bash < 10 even if bash > readGrep', () => {
  const result = analyzePatterns(tools({ Bash: 9, Read: 5 }, 20), baseStats)
  assert.ok(!result.find(i => i.title === 'Bash used more than Read/Grep'))
})

// ─── High loop rate ───────────────────────────────────────────────────────────

test('detects high loop rate when avg_loops >= 1.5', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_loops: 1.5 }))
  const found = result.find(i => i.title === 'Frequent loops detected')
  assert.ok(found, 'should detect high loop rate')
  assert.equal(found!.level, 'warning')
})

test('no loop warning when avg_loops < 1.5', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_loops: 1.4 }))
  assert.ok(!result.find(i => i.title === 'Frequent loops detected'))
})

// ─── Cache ratio ──────────────────────────────────────────────────────────────

test('detects low cache ratio when < 15% with input > 5K', () => {
  // 500 / 10000 = 5% < 15%
  const result = analyzePatterns(tools({}, 20), stats({ avg_cache_read: 500, avg_total_input: 10_000 }))
  const found = result.find(i => i.title === 'Low cache reuse')
  assert.ok(found, 'should detect low cache ratio')
  assert.equal(found!.level, 'tip')
})

test('detects positive high cache ratio when >= 65% with input > 5K', () => {
  // 7000 / 10000 = 70% >= 65%
  const result = analyzePatterns(tools({}, 20), stats({ avg_cache_read: 7_000, avg_total_input: 10_000 }))
  const found = result.find(i => i.title === 'Excellent cache usage')
  assert.ok(found, 'should detect excellent cache usage')
  assert.equal(found!.level, 'positive')
})

test('no cache insight when avg_total_input <= 5K', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_cache_read: 100, avg_total_input: 4_000 }))
  assert.ok(!result.find(i => i.title === 'Low cache reuse'))
  assert.ok(!result.find(i => i.title === 'Excellent cache usage'))
})

test('no cache insight when ratio is in the middle range (15-65%)', () => {
  // 3000 / 10000 = 30%
  const result = analyzePatterns(tools({}, 20), stats({ avg_cache_read: 3_000, avg_total_input: 10_000 }))
  assert.ok(!result.find(i => i.title === 'Low cache reuse'))
  assert.ok(!result.find(i => i.title === 'Excellent cache usage'))
})

test('cache ratio is 0 when avg_total_input is 0 (no div-by-zero)', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_cache_read: 0, avg_total_input: 0 }))
  // ratio = 0, not < 0.15 with input > 5K — no insight
  assert.ok(!result.find(i => i.title === 'Low cache reuse'))
})

// ─── High cost ────────────────────────────────────────────────────────────────

test('detects high cost when avg_cost_usd >= 0.50', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_cost_usd: 0.50 }))
  const found = result.find(i => i.title === 'High cost per session')
  assert.ok(found, 'should detect high cost')
  assert.equal(found!.level, 'tip')
})

test('no cost warning when avg_cost_usd < 0.50', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_cost_usd: 0.49 }))
  assert.ok(!result.find(i => i.title === 'High cost per session'))
})

// ─── Low efficiency ───────────────────────────────────────────────────────────

test('detects low efficiency when avg_efficiency < 65', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_efficiency: 64 }))
  const found = result.find(i => i.title === 'Low efficiency score')
  assert.ok(found, 'should detect low efficiency')
  assert.equal(found!.level, 'warning')
})

test('no efficiency warning at exactly 65', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_efficiency: 65 }))
  assert.ok(!result.find(i => i.title === 'Low efficiency score'))
})

// ─── Heavy context ────────────────────────────────────────────────────────────

test('detects heavy context when avg_total_input > 150K', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_total_input: 151_000 }))
  const found = result.find(i => i.title === 'Very large context per session')
  assert.ok(found, 'should detect heavy context')
  assert.equal(found!.level, 'tip')
})

test('no heavy context at exactly 150K', () => {
  const result = analyzePatterns(tools({}, 20), stats({ avg_total_input: 150_000 }))
  assert.ok(!result.find(i => i.title === 'Very large context per session'))
})

// ─── Agent heavy usage ────────────────────────────────────────────────────────

test('detects heavy Agent usage when agentPct >= 20%', () => {
  // Agent=5 / total=20 = 25%
  const result = analyzePatterns(tools({ Agent: 5 }, 20), baseStats)
  const found = result.find(i => i.title === 'Heavy agent usage')
  assert.ok(found, 'should detect heavy agent usage')
  assert.equal(found!.level, 'positive')
})

test('no Agent insight when agentPct < 20%', () => {
  // Agent=3 / total=20 = 15%
  const result = analyzePatterns(tools({ Agent: 3 }, 20), baseStats)
  assert.ok(!result.find(i => i.title === 'Heavy agent usage'))
})

// ─── Multiple insights at once ────────────────────────────────────────────────

test('can return multiple insights simultaneously', () => {
  const result = analyzePatterns(
    tools({ Read: 25 }, 50),
    stats({ avg_loops: 2.0, avg_cost_usd: 0.80, avg_efficiency: 50 }),
  )
  assert.ok(result.length >= 3, `expected >= 3 insights, got ${result.length}`)
  assert.ok(result.find(i => i.title === 'High Read frequency'))
  assert.ok(result.find(i => i.title === 'Frequent loops detected'))
  assert.ok(result.find(i => i.title === 'High cost per session'))
  assert.ok(result.find(i => i.title === 'Low efficiency score'))
})

// ─── metric field ─────────────────────────────────────────────────────────────

test('metric field is populated for all triggered insights', () => {
  const result = analyzePatterns(
    tools({ Read: 25 }, 50),
    stats({ avg_loops: 2.0, avg_cost_usd: 0.80, avg_cache_read: 500, avg_total_input: 10_000 }),
  )
  for (const insight of result) {
    assert.ok(insight.metric, `insight "${insight.title}" missing metric field`)
  }
})
