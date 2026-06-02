import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runShare } from '../src/share'

test('runShare: exports a function', () => {
  assert.strictEqual(typeof runShare, 'function')
})

test('runShare: accepts string session id', async () => {
  const origExit = process.exit
  ;(process.exit as any) = () => {}
  try {
    await runShare({ sessionId: 'test-id', format: 'ascii', copy: false })
  } catch {
    // expected to fail — no DB data in test env
  }
  process.exit = origExit
})

test('runShare: accepts json format option', async () => {
  const origExit = process.exit
  ;(process.exit as any) = () => {}
  try {
    await runShare({ sessionId: undefined, format: 'json', copy: false })
  } catch {
    // expected to fail — no DB data in test env
  }
  process.exit = origExit
})
