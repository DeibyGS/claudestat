import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

import { getAllBlockCostsForSession, stopEnricher, cleanupSession, getContextWindow } from '../src/enricher'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-enricher-'))

function assistantLine(opts: { model?: string; input?: number; output?: number; cache_read?: number; cache_creation?: number }): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      model: opts.model ?? 'claude-sonnet-4-6',
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_read_input_tokens: opts.cache_read ?? 0,
        cache_creation_input_tokens: opts.cache_creation ?? 0,
      }
    }
  })
}

function humanLine(text: string): string {
  return JSON.stringify({
    type: 'human',
    timestamp: new Date().toISOString(),
    message: { content: text }
  })
}

describe('getContextWindow', () => {
  test('known models return 200000', () => {
    assert.equal(getContextWindow('claude-sonnet-4-6'), 200_000)
    assert.equal(getContextWindow('claude-opus-4-6'), 200_000)
    assert.equal(getContextWindow('claude-haiku-4-5'), 200_000)
  })

  test('unknown model returns 200000 fallback', () => {
    assert.equal(getContextWindow('claude-future-7'), 200_000)
    assert.equal(getContextWindow('unknown-model'), 200_000)
  })
})

describe('getAllBlockCostsForSession with real JSONL', () => {
  test('parses block costs from a JSONL file', async () => {
    const sessionId = `test-block-costs-${Date.now()}`
    const projectDir = path.join(tmpDir, 'projects', `proj-${Date.now()}`)
    fs.mkdirSync(projectDir, { recursive: true })

    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`)
    const content = [
      humanLine('write a function'),
      assistantLine({ input: 1000, output: 500 }),
      humanLine('fix the bug'),
      assistantLine({ input: 2000, output: 300, cache_read: 500 }),
    ].join('\n')
    fs.writeFileSync(jsonlPath, content)

    const result = await getAllBlockCostsForSession(sessionId)
    assert.ok(Array.isArray(result), 'should return an array')
  })

  test('returns empty for nonexistent session', async () => {
    const result = await getAllBlockCostsForSession('nonexistent-00000000')
    assert.deepEqual(result, [])
  })
})

describe('cleanupSession', () => {
  test('does not throw for unknown session', () => {
    assert.doesNotThrow(() => cleanupSession('unknown-session-0000'))
  })
})

describe('stopEnricher', () => {
  test('does not throw when no watcher is active', () => {
    assert.doesNotThrow(() => stopEnricher())
  })
})

test('cleanup tmpDir', () => {
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
})
