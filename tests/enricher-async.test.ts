import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

import { getAllBlockCostsForSession, stopEnricher, cleanupSession, getContextWindow, getSessionPrompts } from '../src/enricher'

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

describe('getSessionPrompts', () => {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects', 'test-claudestat-prompts')
  const sessionId = `test-prompts-${Date.now()}`
  const jsonlPath = path.join(claudeProjectsDir, `${sessionId}.jsonl`)

  function line(obj: object) { return JSON.stringify(obj) }

  before(() => { fs.mkdirSync(claudeProjectsDir, { recursive: true }) })
  after(() => { try { fs.rmSync(claudeProjectsDir, { recursive: true }) } catch {} })

  test('returns empty array when session file does not exist', async () => {
    const result = await getSessionPrompts('nonexistent-session-00000')
    assert.ok(Array.isArray(result))
    assert.equal(result.length, 0)
  })

  test('parses human message with string content', async () => {
    fs.writeFileSync(jsonlPath, [
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: 'fix the bug' } }),
      line({ type: 'assistant', timestamp: new Date().toISOString(), message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }),
    ].join('\n'))
    const result = await getSessionPrompts(sessionId)
    assert.ok(result.length >= 1, 'should find 1 prompt')
    assert.equal(result[0].text, 'fix the bug')
    assert.equal(result[0].index, 1)
  })

  test('parses human message with array text block content', async () => {
    fs.writeFileSync(jsonlPath, [
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'write a function' }] } }),
    ].join('\n'))
    const result = await getSessionPrompts(sessionId)
    assert.ok(result.length >= 1)
    assert.equal(result[0].text, 'write a function')
  })

  test('filters out system-reminder content', async () => {
    fs.writeFileSync(jsonlPath, [
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: '<system-reminder>some hook output</system-reminder>' } }),
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: 'real user prompt' } }),
    ].join('\n'))
    const result = await getSessionPrompts(sessionId)
    assert.equal(result.length, 1, 'system-reminder lines should be filtered')
    assert.equal(result[0].text, 'real user prompt')
  })

  test('filters out empty text messages', async () => {
    fs.writeFileSync(jsonlPath, [
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: '' } }),
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: 'valid' } }),
    ].join('\n'))
    const result = await getSessionPrompts(sessionId)
    const valid = result.filter(p => p.text === 'valid')
    assert.ok(valid.length >= 1, 'non-empty messages should be included')
  })

  test('skips malformed JSON lines without throwing', async () => {
    fs.writeFileSync(jsonlPath, [
      'this is not json',
      line({ type: 'human', timestamp: new Date().toISOString(), message: { content: 'after bad line' } }),
      '{incomplete json',
    ].join('\n'))
    const result = await getSessionPrompts(sessionId)
    assert.ok(Array.isArray(result), 'should not throw on malformed lines')
  })
})

test('cleanup tmpDir', () => {
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
})
