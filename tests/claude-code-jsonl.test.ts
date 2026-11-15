import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { processJSONL } from '../src/watchers/claude-code'

// Claude Code logs ONE JSONL line per content block of the same API call:
// every line repeats message.id and the full usage of the call.

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-jsonl-'))
  return path.join(dir, `${name}.jsonl`)
}

function assistantLine(id: string, input: number, block: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-06T10:00:00.000Z',
    message: {
      id,
      model: 'claude-opus-5-5',
      content: [{ type: block }],
      usage: {
        input_tokens: input, output_tokens: 10,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
      },
    },
  })
}

describe('processJSONL — duplicate content-block lines', () => {
  test('counts one API call logged as 3 lines only once', async () => {
    const f = tmpFile('dup')
    fs.writeFileSync(f, [
      assistantLine('msg_1', 1000, 'thinking'),
      assistantLine('msg_1', 1000, 'text'),
      assistantLine('msg_1', 1000, 'tool_use'),
      assistantLine('msg_2', 500, 'text'),
    ].join('\n') + '\n')

    const r = await processJSONL(f)
    assert.ok(r)
    assert.equal(r!.input_tokens, 1500)   // 1000 + 500, NOT 3500
    assert.equal(r!.output_tokens, 20)    // 10 × 2 API calls
    // official claude-opus-5-5 prices: $4/M input · $20/M output
    assert.ok(Math.abs(r!.cost_usd - (1500 * 4 + 20 * 20) / 1_000_000) < 1e-12)
  })

  test('incremental poll skips duplicates seen in a previous poll', async () => {
    const f = tmpFile('incr')
    fs.writeFileSync(f, assistantLine('msg_1', 1000, 'text') + '\n')

    const r1 = await processJSONL(f)
    assert.equal(r1!.input_tokens, 1000)

    fs.appendFileSync(f,
      assistantLine('msg_1', 1000, 'tool_use') + '\n' +
      assistantLine('msg_2', 200, 'text') + '\n')

    const r2 = await processJSONL(f)
    assert.equal(r2!.input_tokens, 1200)  // msg_1 duplicate skipped, msg_2 added
    assert.equal(r2!.output_tokens, 20)
  })

  test('lines without message.id are never dropped', async () => {
    const f = tmpFile('noid')
    const line = (input: number) => JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    })
    fs.writeFileSync(f, line(100) + '\n' + line(200) + '\n')

    const r = await processJSONL(f)
    assert.equal(r!.input_tokens, 300)
  })
})

describe('processJSONL — cost-state authority', () => {
  test('cost-state totalCostUSD overrides computed cost', async () => {
    const f = tmpFile('coststate')
    fs.writeFileSync(f, [
      assistantLine('msg_1', 1000, 'text'),
      JSON.stringify({ type: 'cost-state', totalCostUSD: 42.5 }),
    ].join('\n') + '\n')

    const r = await processJSONL(f)
    assert.ok(r)
    assert.equal(r!.cost_usd, 42.5)
    assert.equal(r!.input_tokens, 1000)   // tokens still tracked normally
  })

  test('zero/invalid cost-state is ignored', async () => {
    const f = tmpFile('coststate-zero')
    fs.writeFileSync(f, [
      assistantLine('msg_1', 1_000_000, 'text'),
      JSON.stringify({ type: 'cost-state', totalCostUSD: 0 }),
    ].join('\n') + '\n')

    const r = await processJSONL(f)
    assert.ok(r)
    assert.ok(r!.cost_usd > 0)            // falls back to computed cost
  })
})

// S5 — Claude Code stores sub-agents at <project>/<parentId>/subagents/agent-<id>.jsonl
describe('processJSONL — sub-agent parent link and cost source', () => {
  test('a sub-agent JSONL carries its parent session id from the path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sub-'))
    const parentId = '262c8fea-9824-4d1a-b1be-990e1f93c625'
    const dir = path.join(root, parentId, 'subagents')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'agent-a6a7e9c02c7e87153.jsonl')
    fs.writeFileSync(f, assistantLine('msg_s1', 100, 'text') + '\n')

    const r = await processJSONL(f)
    assert.equal(r!.parentSessionId, parentId)
    assert.equal(r!.costSource, 'computed')
  })

  test('a top-level session has no parent; cost-state marks the cost source', async () => {
    const f = tmpFile('top-level')
    fs.writeFileSync(f, [
      assistantLine('msg_t1', 100, 'text'),
      JSON.stringify({ type: 'cost-state', totalCostUSD: 3.5 }),
    ].join('\n') + '\n')

    const r = await processJSONL(f)
    assert.equal(r!.parentSessionId, undefined)
    assert.equal(r!.costSource, 'cost-state')
  })

  test('onCostUpdate stores the path-derived parent, overriding a heuristic guess', () => {
    // lazy require: the DB module must load after the test runner sets CLAUDESTAT_DB_PATH
    const { dbOps } = require('../src/db')
    const { onCostUpdate } = require('../src/routes/events')
    const kid = 'agent-s5linktest0001'
    dbOps.upsertSession({ id: kid, cwd: '/tmp/s5', started_at: Date.now(), source: 'claude-code' })
    dbOps.updateSessionParent(kid, 'wrong-heuristic-parent')

    onCostUpdate(kid, {
      input_tokens: 1, output_tokens: 1, cache_read: 0, cache_creation: 0, cost_usd: 0.01,
      context_used: 0, context_window: 0, firstTs: Date.now(),
      parentSessionId: 'real-parent-from-path', costSource: 'computed',
    }, 'claude-code')

    assert.equal(dbOps.getSession(kid).parent_session_id, 'real-parent-from-path')
  })
})
