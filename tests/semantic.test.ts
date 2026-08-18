import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { extractSemanticData } from '../src/watchers/claude-code'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= os.tmpdir()

function makeJSONL(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n')
}

let tmpDir: string
let tmpFile: string

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudestat-semantic-'))
  tmpFile = path.join(tmpDir, 'test.jsonl')
})

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('extractSemanticData', () => {
  test('returns null for missing file', async () => {
    const result = await extractSemanticData('/nonexistent/path/test.jsonl')
    assert.equal(result, null)
  })

  test('parses text blocks and tool_use from assistant messages', async () => {
    const content = makeJSONL([
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: [
            { type: 'text', text: 'Here is my analysis.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'foo.ts' } },
          ],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
      {
        type: 'human',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents', is_error: false },
          ],
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    assert.equal(result.turns.length, 1)
    assert.equal(result.turns[0].turn_index, 0)
    assert.equal(result.turns[0].tool_calls.length, 1)
    assert.equal(result.turns[0].tool_calls[0], 'Read')
    assert.equal(result.turns[0].text_preview, 'Here is my analysis.')
    assert.equal(result.turns[0].output_chars, 'Here is my analysis.'.length)
    assert.equal(result.turns[0].error_count, 0)
    assert.equal(result.error_block_count, 0)
  })

  test('counts is_error tool_results correctly', async () => {
    const content = makeJSONL([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} },
          ],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 50, output_tokens: 5 },
        },
      },
      {
        type: 'human',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'ENOENT: no such file', is_error: true },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: {} },
          ],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 60, output_tokens: 5 },
        },
      },
      {
        type: 'human',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_3', content: 'ok', is_error: false },
          ],
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    assert.equal(result.turns.length, 2)
    assert.equal(result.turns[0].error_count, 1)
    assert.equal(result.turns[1].error_count, 0)
    assert.equal(result.error_block_count, 1)
  })

  test('truncates text_preview to 500 chars', async () => {
    const longText = 'x'.repeat(1000)
    const content = makeJSONL([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: longText }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 200, output_tokens: 250 },
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    assert.equal(result.turns[0].text_preview.length, 500)
    assert.equal(result.turns[0].output_chars, 1000)
  })

  test('computes avg_output_chars across multiple turns', async () => {
    const content = makeJSONL([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'ab' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'abcd' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    assert.equal(result.turns.length, 2)
    assert.equal(result.avg_output_chars, 3) // (2+4)/2 = 3
  })

  test('captures LLM metadata (effort, model, stop_reason, stop_sequence) per turn', async () => {
    const content = makeJSONL([
      {
        type: 'assistant',
        effort: 'high',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          model: 'claude-sonnet-5',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      },
      {
        type: 'assistant',
        effort: 'low',
        message: {
          content: [{ type: 'text', text: 'tool time' }],
          model: 'claude-opus-5',
          stop_reason: 'tool_use',
          stop_sequence: ['grep'],
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    assert.equal(result.turns.length, 2)
    assert.equal(result.turns[0].model, 'claude-sonnet-5')
    assert.equal(result.turns[0].effort, 'high')
    assert.equal(result.turns[0].stop_reason, 'end_turn')
    assert.equal(result.turns[0].stop_sequence, undefined)
    assert.equal(result.turns[1].model, 'claude-opus-5')
    assert.equal(result.turns[1].effort, 'low')
    assert.equal(result.turns[1].stop_reason, 'tool_use')
    assert.equal(result.turns[1].stop_sequence, JSON.stringify(['grep']))
  })

  test('leaves LLM metadata undefined when absent from the raw line', async () => {
    const content = makeJSONL([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'no meta' }],
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ])
    await fs.writeFile(tmpFile, content)

    const result = await extractSemanticData(tmpFile)
    assert.ok(result !== null)
    const turn = result.turns[0]
    assert.equal(turn.model, undefined)
    assert.equal(turn.effort, undefined)
    assert.equal(turn.stop_reason, undefined)
    assert.equal(turn.stop_sequence, undefined)
  })
})
