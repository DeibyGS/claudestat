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
