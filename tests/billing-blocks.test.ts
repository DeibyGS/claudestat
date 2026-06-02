import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbOps } from '../src/db'

function insertSession(id: string, startedAt: number, cost: number, inputTok: number, outputTok: number) {
  dbOps.upsertSession({ id, cwd: '/tmp', started_at: startedAt, last_event_at: startedAt })
  dbOps.updateSessionCost(id, {
    cost_usd: cost, input_tokens: inputTok, output_tokens: outputTok,
    cache_read: 0, cache_creation: 0, context_used: 0, context_window: 0,
  }, 100, 0)
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
