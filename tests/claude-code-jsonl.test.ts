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

// S6 — project, branch and tool calls come from the JSONL even when no hook fired
describe('processJSONL — cwd, branch and tool_use capture', () => {
  // Claude Code logs one line per content block: each tool_use of the same API
  // call arrives on its own line, all repeating message.id and usage.
  function toolUseLine(msgId: string, toolId: string, name: string, input: object, ts: string): string {
    return JSON.stringify({
      type: 'assistant', timestamp: ts,
      cwd: '/work/repo', gitBranch: 'feat/x',
      message: {
        id: msgId, model: 'claude-opus-5-5',
        content: [{ type: 'tool_use', id: toolId, name, input }],
        usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
  }

  test('returns cwd, branch and every tool_use, including ones on duplicate message lines', async () => {
    const f = tmpFile('tools')
    fs.writeFileSync(f, [
      JSON.stringify({ type: 'user', cwd: '/work/repo', gitBranch: 'main', message: { content: 'hi' } }),
      toolUseLine('msg_a', 'toolu_1', 'Read', { file_path: '/work/repo/a.ts' }, '2026-11-15T10:00:00.000Z'),
      toolUseLine('msg_a', 'toolu_2', 'Grep', { pattern: 'x' }, '2026-11-15T10:00:00.500Z'),
      toolUseLine('msg_b', 'toolu_3', 'Bash', { command: 'ls' }, '2026-11-15T10:00:05.000Z'),
    ].join('\n') + '\n')

    const r = await processJSONL(f)
    assert.equal(r!.cwd, '/work/repo')
    assert.equal(r!.gitBranch, 'feat/x')            // latest line wins (branch can change)
    assert.deepEqual(r!.toolUses!.map(t => [t.id, t.name]), [['toolu_1', 'Read'], ['toolu_2', 'Grep'], ['toolu_3', 'Bash']])
    assert.equal(r!.toolUses![2].ts, Date.parse('2026-11-15T10:00:05.000Z'))
    assert.equal(r!.toolUses![0].input, JSON.stringify({ file_path: '/work/repo/a.ts' }))
    assert.equal(r!.input_tokens, 20)               // usage still counted once per message
  })

  test("gitBranch 'HEAD' (no repo / detached) is not reported as a branch", async () => {
    const f = tmpFile('head')
    fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd: '/Users/me', gitBranch: 'HEAD', message: { content: 'hi' } }) + '\n')
    const r = await processJSONL(f)
    assert.equal(r!.cwd, '/Users/me')
    assert.equal(r!.gitBranch, undefined)
  })

  test('an incremental poll only returns new tool_use blocks', async () => {
    const f = tmpFile('tools-incr')
    fs.writeFileSync(f, toolUseLine('msg_a', 'toolu_a1', 'Read', {}, '2026-11-15T10:00:00.000Z') + '\n')
    await processJSONL(f)
    fs.appendFileSync(f, toolUseLine('msg_b', 'toolu_b1', 'Edit', {}, '2026-11-15T10:01:00.000Z') + '\n')

    const r2 = await processJSONL(f)
    assert.deepEqual(r2!.toolUses!.map(t => t.id), ['toolu_b1'])
  })

  test('onCostUpdate stores cwd/project/branch and one Done event per tool_use, idempotently', () => {
    const { dbOps } = require('../src/db')
    const { onCostUpdate } = require('../src/routes/events')
    const sid = 's6-jsonl-only-0001'
    const t0 = Date.parse('2026-11-15T10:00:00.000Z')
    const cost = {
      input_tokens: 1, output_tokens: 1, cache_read: 0, cache_creation: 0, cost_usd: 0.01,
      context_used: 0, context_window: 0, firstTs: t0, costSource: 'computed' as const,
      cwd: '/work/repo', gitBranch: 'feat/x',
      toolUses: [
        { id: 'toolu_s6_1', name: 'Read', input: '{}', ts: t0 },
        { id: 'toolu_s6_2', name: 'Grep', input: '{}', ts: t0 + 500 },
        { id: 'toolu_s6_3', name: 'Bash', input: '{"command":"ls"}', ts: t0 + 5000 },
      ],
    }
    onCostUpdate(sid, cost, 'claude-code')
    onCostUpdate(sid, cost, 'claude-code')          // daemon restart re-reads the file

    const s = dbOps.getSession(sid)
    assert.equal(s.cwd, '/work/repo')
    assert.equal(s.project_path, '/work/repo')
    assert.equal(s.git_branch, 'feat/x')
    const done = dbOps.getSessionEvents(sid).filter((e: any) => e.type === 'Done')
    assert.deepEqual(done.map((e: any) => e.tool_name), ['Read', 'Grep', 'Bash'])
  })

  test('a legacy hook row without tool_use_id (same tool, within 5s) is not duplicated', () => {
    const { dbOps } = require('../src/db')
    const { onCostUpdate } = require('../src/routes/events')
    const sid = 's6-legacy-hook-0001'
    const t0 = Date.parse('2026-11-15T11:00:00.000Z')
    dbOps.upsertSession({ id: sid, cwd: '/work/repo', started_at: t0, source: 'claude-code' })
    dbOps.insertEvent({ session_id: sid, type: 'Done', tool_name: 'Read', ts: t0 + 1200, source: 'claude-code' })

    onCostUpdate(sid, {
      input_tokens: 1, output_tokens: 1, cache_read: 0, cache_creation: 0, cost_usd: 0.01,
      context_used: 0, context_window: 0, firstTs: t0, costSource: 'computed' as const,
      toolUses: [
        { id: 'toolu_leg_1', name: 'Read', input: '{}', ts: t0 },
        { id: 'toolu_leg_2', name: 'Bash', input: '{}', ts: t0 + 100 },
      ],
    }, 'claude-code')

    const tools = dbOps.getSessionEvents(sid).map((e: any) => e.tool_name).sort()
    assert.deepEqual(tools, ['Bash', 'Read'])
  })
})
