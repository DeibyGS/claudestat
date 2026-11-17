import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'

function insertSession(
  id: string, startedAt: number, cost: number, inputTok: number, outputTok: number,
  opts: { costSource?: 'cost-state' | 'computed'; parentId?: string } = {},
) {
  dbOps.upsertSession({ id, cwd: '/tmp', started_at: startedAt, last_event_at: startedAt })
  dbOps.updateSessionCost(id, {
    cost_usd: cost, input_tokens: inputTok, output_tokens: outputTok,
    cache_read: 0, cache_creation: 0, context_used: 0, context_window: 0,
    costSource: opts.costSource,
  }, 100, 0)
  if (opts.parentId) dbOps.updateSessionParent(id, opts.parentId)
}

test('getBillingBlocks: sessions in 2 different blocks return 2 entries ordered desc', () => {
  const block1 = Math.floor(Date.now() / 18_000_000) * 18_000_000
  const block2 = block1 - 18_000_000
  insertSession('bb-s1', block1 + 1000, 0.05, 1000, 500)
  insertSession('bb-s2', block2 + 1000, 0.03, 800,  300)

  const blocks = dbOps.getBillingBlocks(10)
  const relevant = blocks.filter(b => b.block_start === block1 || b.block_start === block2)
  assert.equal(relevant.length, 2)
  assert.ok(relevant[0].block_start > relevant[1].block_start, 'ordered desc')
})

test('getBillingBlocks: sessions in same block aggregate into 1 entry', () => {
  const blockStart = Math.floor(Date.now() / 18_000_000) * 18_000_000
  insertSession('bb-same1', blockStart + 100, 0.01, 100, 50)
  insertSession('bb-same2', blockStart + 200, 0.02, 200, 80)

  const blocks = dbOps.getBillingBlocks(20)
  const match = blocks.filter(b => b.block_start === blockStart)
  assert.equal(match.length, 1)
  assert.ok(match[0].sessions >= 2)
})

test('getBillingBlocks: is_current true for block containing Date.now()', () => {
  const now = Date.now()
  const blockStart = Math.floor(now / 18_000_000) * 18_000_000
  insertSession('bb-curr1', blockStart + 500, 0.01, 100, 50)

  const blocks = dbOps.getBillingBlocks(20)
  const current = blocks.find(b => b.is_current)
  assert.ok(current, 'should have a current block')
  assert.equal(current!.block_start, blockStart)
})

test('getBillingBlocks: limit is respected', () => {
  const blocks = dbOps.getBillingBlocks(1)
  assert.ok(blocks.length <= 1)
})

// S2 — a parent's cost-state total already includes its sub-agents, so their
// own cost must not be added again (tokens still count: they are real usage).
test('S2: block and daily totals do not double count sub-agents covered by cost-state', () => {
  const blockStart = Math.floor(1_700_000_000_000 / 18_000_000) * 18_000_000 // isolated past block
  const at = (n: number) => blockStart + 60_000 * n

  insertSession('s2-parent', at(1), 19.56, 1000, 500, { costSource: 'cost-state' })
  const kids = [1.20, 0.90, 0.80, 0.76, 0.70, 0.50] // 4.86
  kids.forEach((c, i) => insertSession(`agent-s2-kid${i}`, at(2 + i), c, 100, 50, { parentId: 's2-parent' }))
  // Edge: parent unknown → child counted once
  insertSession('agent-s2-orphan', at(10), 0.50, 10, 5, { parentId: 'not-in-db' })
  // Edge: parent without cost-state (computed from lines) → child counted
  insertSession('s2-parent-computed', at(11), 1.00, 10, 5, { costSource: 'computed' })
  insertSession('agent-s2-kid-computed', at(12), 0.25, 10, 5, { parentId: 's2-parent-computed' })

  // Edge: a top-level session (another terminal) mislinked by the cwd heuristic
  // keeps its cost — only `agent-*` sub-agent sessions are covered by cost-state
  insertSession('s2-other-terminal', at(13), 2.00, 10, 5, { parentId: 's2-parent' })

  const expected = 19.56 + 0.50 + 1.00 + 0.25 + 2.00
  const block = dbOps.getBillingBlocks(100_000).find(b => b.block_start === blockStart)
  assert.ok(block, 'fixture block exists')
  assert.ok(Math.abs(block!.total_cost_usd - expected) < 1e-9, `block ${block!.total_cost_usd} vs ${expected}`)
  assert.equal(block!.sessions, 11)                          // every session still listed
  assert.equal(block!.total_tokens, 1500 + 6 * 150 + 4 * 15)  // sub-agent tokens still counted

  const day = new Date(at(1)).toISOString().slice(0, 10)
  const daily = dbOps.getDailyActivity(5000).find(d => d.date === day)
  assert.ok(daily && Math.abs(daily.cost_usd - expected) < 1e-6, `daily ${daily?.cost_usd} vs ${expected}`)

  // Row readers feed JS-side sums (History day totals, reports): billable_cost_usd
  // dedups, while total_cost_usd keeps each session's own cost for display.
  const fixture = (dbOps.getRecentSessions(5000) as Array<{ id: string; billable_cost_usd: number; total_cost_usd: number }>)
    .filter(r => r.id.startsWith('s2-') || r.id.startsWith('agent-s2-'))
  assert.equal(fixture.length, 11)
  const billable = fixture.reduce((a, r) => a + r.billable_cost_usd, 0)
  assert.ok(Math.abs(billable - expected) < 1e-9, `rows ${billable} vs ${expected}`)
  assert.equal(fixture.find(r => r.id === 'agent-s2-kid0')!.total_cost_usd, 1.20)
})

// S7 — the current block aligns to the OAuth usage API's real [resets_at-5h, resets_at)
// window, and its cost sums only priced assistant-turn rows inside it.
test('S7: with resetsAt, the current block is [resetsAt-5h, resetsAt) and sums priced turns', () => {
  const { dbOps } = require('../src/db')
  const FIVE_H = 5 * 60 * 60 * 1000
  const resetsAt = Date.now() + 37 * 60_000   // mid-cycle: resets in 37 min
  const windowStart = resetsAt - FIVE_H

  const sid = 's7-sess-1'
  dbOps.upsertSession({ id: sid, cwd: '/tmp', started_at: windowStart + 60_000 })
  dbOps.upsertAssistantTurns(sid, [
    { turn_index: 0, ts: windowStart + 1000, error_count: 0, output_chars: 1, context_used: 0,
      cost_usd: 1.5, priced: true, input_tokens: 100, output_tokens: 50, lines_added: 0, lines_removed: 0, api_ms: 0, tool_ms: 0 },
    { turn_index: 1, ts: windowStart + 2000, error_count: 0, output_chars: 1, context_used: 0,
      cost_usd: null, priced: false, input_tokens: 10, output_tokens: 5, lines_added: 0, lines_removed: 0, api_ms: 0, tool_ms: 0 },
    // outside the real window (belongs to the previous 5h cycle) — must not count
    { turn_index: 2, ts: windowStart - 1000, error_count: 0, output_chars: 1, context_used: 0,
      cost_usd: 99, priced: true, input_tokens: 1, output_tokens: 1, lines_added: 0, lines_removed: 0, api_ms: 0, tool_ms: 0 },
  ])

  const blocks = dbOps.getBillingBlocks(20, resetsAt)
  const current = blocks.find((b: any) => b.is_current)
  assert.ok(current, 'should have a current block')
  assert.equal(current!.block_start, windowStart)
  assert.equal(current!.block_end, resetsAt)
  assert.equal(current!.total_cost_usd, 1.5)      // unpriced turn excluded, out-of-window turn excluded
  assert.equal(current!.total_tokens, 100 + 50 + 10 + 5)  // tokens count even when unpriced
  assert.equal(current!.sessions, 1)
})

// S7 regression (code-review finding) — the epoch grid and the real [resetsAt-5h, resetsAt)
// window are almost never aligned, so a grid cell can straddle realStart. A session that
// started on the "current" side of that cell must not be summed both in the historical grid
// row (whole-cell GROUP BY) and again in the current block's turnAgg.
test('S7: a straddling grid cell does not double-count sessions on both sides of realStart', () => {
  const FIVE_H = 5 * 60 * 60 * 1000
  // Fixed, isolated anchor (not Date.now()-relative) so this fixture's grid cell can't
  // collide with another "now minus a few hours" fixture elsewhere in this file.
  const resetsAt  = 1_650_000_000_000 + FIVE_H + 123_456
  const realStart = resetsAt - FIVE_H
  const gridStart = Math.floor(realStart / 18_000_000) * 18_000_000
  assert.ok(gridStart < realStart && realStart < gridStart + 18_000_000, 'fixture assumes a straddling grid cell')

  // Session A: started before realStart, in the same grid cell — stays historical.
  insertSession('s7-straddle-before', gridStart + 1000, 10, 100, 50)

  // Session B: started AFTER realStart but inside the SAME grid cell — the overlap the old
  // code double-counted (whole-cell historical sum + its own turns in turnAgg).
  insertSession('s7-straddle-after', realStart + 1000, 20, 10, 5)
  dbOps.upsertAssistantTurns('s7-straddle-after', [
    { turn_index: 0, ts: realStart + 2000, error_count: 0, output_chars: 1, context_used: 0,
      cost_usd: 20, priced: true, input_tokens: 10, output_tokens: 5, lines_added: 0, lines_removed: 0, api_ms: 0, tool_ms: 0 },
  ])

  const blocks = dbOps.getBillingBlocks(50, resetsAt)
  const current    = blocks.find((b: any) => b.is_current)
  const historical = blocks.find((b: any) => b.block_start === gridStart)

  assert.ok(historical, 'the straddling grid cell should still appear historically')
  assert.equal(historical!.sessions, 1)        // only session A — B must not appear here too
  assert.equal(historical!.total_cost_usd, 10)

  assert.equal(current!.sessions, 1)           // only session B, counted once via its own turns
  assert.equal(current!.total_cost_usd, 20)
})

test('S7 fallback: without resetsAt the grid grouping is unchanged', () => {
  const { dbOps } = require('../src/db')
  const blockStart = Math.floor(Date.now() / 18_000_000) * 18_000_000
  insertSession('s7-fallback-1', blockStart + 500, 0.02, 100, 50)

  const blocks = dbOps.getBillingBlocks(20)
  const current = blocks.find((b: any) => b.is_current)
  assert.ok(current, 'should have a current block')
  assert.equal(current!.block_start, blockStart)
  assert.equal(current!.block_end, blockStart + 18_000_000)
})
