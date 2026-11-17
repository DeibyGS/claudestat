import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { extractSemanticData } from '../src/watchers/claude-code'

// live-tab-v2 S1-S5: per-turn cost/usage, lines changed, API/tool time,
// thinking estimate, compactions — all derived from the raw CC JSONL.

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-turns-'))
  return path.join(dir, `${name}.jsonl`)
}

function userLine(ts: string, content: unknown, toolUseResult?: unknown): string {
  return JSON.stringify({ type: 'user', timestamp: ts, message: { content }, ...(toolUseResult !== undefined ? { toolUseResult } : {}) })
}

function assistantLine(id: string, model: string, ts: string, content: unknown[], usage: Record<string, number>): string {
  return JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model, content, usage } })
}

function toolUseBlock(id: string, name: string, input: object = {}) {
  return { type: 'tool_use', id, name, input }
}

function toolResultLine(ts: string, toolUseId: string, isError: boolean, toolUseResult: unknown) {
  return userLine(ts, [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: isError ? 'error' : 'ok' }], toolUseResult)
}

describe('extractSemanticData — S1 per-turn cost/usage', () => {
  test('a priced model gets cost_usd + priced=true; an unpriced one gets null + priced=false', async () => {
    const f = tmpFile('s1')
    fs.writeFileSync(f, [
      userLine('2026-11-17T10:00:00.000Z', 'hi'),
      assistantLine('m1', 'claude-opus-5-5', '2026-11-17T10:00:01.000Z', [{ type: 'text', text: 'ok' }],
        { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      userLine('2026-11-17T10:00:02.000Z', 'next'),
      assistantLine('m2', 'some-unreleased-model', '2026-11-17T10:00:03.000Z', [{ type: 'text', text: 'ok2' }],
        { input_tokens: 500, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.turns.length, 2)
    assert.equal(r!.turns[0].priced, true)
    assert.ok((r!.turns[0].cost_usd ?? 0) > 0)
    assert.equal(r!.turns[0].input_tokens, 1000)
    assert.equal(r!.turns[1].priced, false)
    assert.equal(r!.turns[1].cost_usd, null)   // never $0 or a Sonnet estimate
  })
})

describe('extractSemanticData — S2 lines changed per turn', () => {
  test('Edit + MultiEdit + Write(new) add up; a failed Edit adds 0', async () => {
    const f = tmpFile('s2')
    fs.writeFileSync(f, [
      userLine('2026-11-17T10:00:00.000Z', 'edit some files'),
      assistantLine('m1', 'claude-opus-5-5', '2026-11-17T10:00:01.000Z', [
        toolUseBlock('t1', 'Edit', { file_path: 'a.ts' }),
        toolUseBlock('t2', 'MultiEdit', { file_path: 'b.ts' }),
        toolUseBlock('t3', 'Write', { file_path: 'c.ts' }),
        toolUseBlock('t4', 'Edit', { file_path: 'd.ts' }),
      ], { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      toolResultLine('2026-11-17T10:00:01.200Z', 't1', false, { type: 'update', structuredPatch: [{ lines: [' ctx', '+added1', '+added2', '-removed1'] }] }),
      toolResultLine('2026-11-17T10:00:01.300Z', 't2', false, { type: 'update', structuredPatch: [{ lines: ['+a', '+b', '+c'] }] }),
      toolResultLine('2026-11-17T10:00:01.400Z', 't3', false, { type: 'create', content: 'line1\nline2\nline3' }),
      toolResultLine('2026-11-17T10:00:01.500Z', 't4', true, 'permission denied'),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.turns.length, 1)
    assert.equal(r!.turns[0].lines_added, 2 + 3 + 3)
    assert.equal(r!.turns[0].lines_removed, 1)
  })
})

describe('extractSemanticData — S3 API time vs tool time', () => {
  test('api_ms is the gap since the previous user line; tool_ms sums tool_use->tool_result gaps', async () => {
    const f = tmpFile('s3')
    fs.writeFileSync(f, [
      userLine('2026-11-17T10:00:00.000Z', 'go'),
      assistantLine('m1', 'claude-opus-5-5', '2026-11-17T10:00:01.000Z', [
        toolUseBlock('t1', 'Read', { file_path: 'a.ts' }),
      ], { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      toolResultLine('2026-11-17T10:00:01.500Z', 't1', false, { type: 'text' }),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.turns[0].api_ms, 1000)   // 10:00:01.000 - 10:00:00.000
    assert.equal(r!.turns[0].tool_ms, 500)   // 10:00:01.500 - 10:00:01.000
  })

  test('a missing or negative gap contributes 0, never a negative value', async () => {
    const f = tmpFile('s3-edge')
    fs.writeFileSync(f, [
      assistantLine('m1', 'claude-opus-5-5', '2026-11-17T10:00:01.000Z', [
        toolUseBlock('t1', 'Read', {}),
      ], { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      // tool_result timestamped BEFORE its tool_use (clock skew) — gap must clamp to 0
      toolResultLine('2026-11-17T10:00:00.500Z', 't1', false, { type: 'text' }),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.turns[0].api_ms, 0)   // no previous user line
    assert.equal(r!.turns[0].tool_ms, 0)
  })
})

describe('extractSemanticData — S4 thinking tokens estimate', () => {
  test('a non-empty thinking block is estimated; an empty/redacted one is undefined', async () => {
    const f = tmpFile('s4')
    fs.writeFileSync(f, [
      userLine('2026-11-17T10:00:00.000Z', 'think'),
      assistantLine('m1', 'claude-opus-5-5', '2026-11-17T10:00:01.000Z', [
        { type: 'thinking', thinking: 'a'.repeat(40) },
        { type: 'text', text: 'ok' },
      ], { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      userLine('2026-11-17T10:00:02.000Z', 'next'),
      assistantLine('m2', 'claude-opus-5-5', '2026-11-17T10:00:03.000Z', [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'ok2' },
      ], { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.turns[0].thinking_tokens_est, 10)   // ceil(40/4)
    assert.equal(r!.turns[1].thinking_tokens_est, undefined)
  })
})

describe('extractSemanticData — S5 compactions', () => {
  test('a compact_boundary system message is recorded with ts, trigger and pre_tokens', async () => {
    const f = tmpFile('s5')
    fs.writeFileSync(f, [
      JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-17T10:05:00.000Z', compactMetadata: { trigger: 'manual', preTokens: 12345 } }),
    ].join('\n') + '\n')

    const r = await extractSemanticData(f)
    assert.ok(r)
    assert.equal(r!.compactions.length, 1)
    assert.equal(r!.compactions[0].trigger, 'manual')
    assert.equal(r!.compactions[0].pre_tokens, 12345)
    assert.equal(r!.compactions[0].ts, Date.parse('2026-11-17T10:05:00.000Z'))
  })
})

describe('migration 33 — assistant_turns/compactions roundtrip (additive, idempotent)', () => {
  test('new columns round-trip through upsert/get without disturbing existing fields', () => {
    const { dbOps } = require('../src/db')
    const sid = 'turn-metrics-roundtrip-0001'
    dbOps.upsertSession({ id: sid, cwd: '/tmp/x', started_at: Date.now(), source: 'claude-code' })
    dbOps.upsertAssistantTurns(sid, [{
      turn_index: 0, ts: Date.now(), text_preview: 'hi', tool_calls: ['Read'],
      error_count: 0, output_chars: 2, context_used: 10, model: 'claude-opus-5-5',
      cost_usd: 0.05, input_tokens: 100, output_tokens: 10, cache_read: 0, cache_creation: 0, priced: true,
      lines_added: 3, lines_removed: 1, api_ms: 500, tool_ms: 200, thinking_tokens_est: 7,
    }])
    dbOps.upsertCompactions(sid, [{ ts: Date.now(), trigger: 'auto', pre_tokens: 9000 }])

    const turns = dbOps.getAssistantTurns(sid)
    assert.equal(turns.length, 1)
    assert.equal(turns[0].cost_usd, 0.05)
    assert.equal(turns[0].priced, true)
    assert.equal(turns[0].lines_added, 3)
    assert.equal(turns[0].lines_removed, 1)
    assert.equal(turns[0].api_ms, 500)
    assert.equal(turns[0].tool_ms, 200)
    assert.equal(turns[0].thinking_tokens_est, 7)
    assert.equal(turns[0].tool_calls[0], 'Read')   // pre-existing field untouched

    const compactions = dbOps.getCompactions(sid)
    assert.equal(compactions.length, 1)
    assert.equal(compactions[0].trigger, 'auto')
    assert.equal(compactions[0].pre_tokens, 9000)
  })

  test('an unpriced turn stores NULL cost_usd, not 0', () => {
    const { dbOps } = require('../src/db')
    const sid = 'turn-metrics-unpriced-0001'
    dbOps.upsertSession({ id: sid, cwd: '/tmp/x', started_at: Date.now(), source: 'claude-code' })
    dbOps.upsertAssistantTurns(sid, [{
      turn_index: 0, error_count: 0, output_chars: 1, context_used: 0,
      cost_usd: null, priced: false, lines_added: 0, lines_removed: 0, api_ms: 0, tool_ms: 0,
    }])
    const turns = dbOps.getAssistantTurns(sid)
    assert.equal(turns[0].cost_usd, null)
    assert.equal(turns[0].priced, false)
  })
})
