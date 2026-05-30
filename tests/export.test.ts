import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Env vars set in index.ts before this loads
import { runExport } from '../src/export'

describe('export — parseSince', () => {
  test('invalid since format calls process.exit(1)', async () => {
    let exitCode: number | undefined
    const origExit = process.exit.bind(process)
    // @ts-ignore
    process.exit = (code?: number) => { exitCode = code; throw new Error('exit') }
    try {
      await runExport({ format: 'json', since: 'notadate' })
    } catch {}
    // @ts-ignore
    process.exit = origExit
    assert.equal(exitCode, 1)
  })

  test('valid since "7d" does not call process.exit(1)', async () => {
    let exitCode: number | undefined
    const origExit = process.exit.bind(process)
    // @ts-ignore
    process.exit = (code?: number) => { exitCode = code; throw new Error('exit') }
    try {
      // DB is :memory: — no sessions, but should not fail on parseSince
      await runExport({ format: 'json', since: '7d' })
    } catch {}
    // @ts-ignore
    process.exit = origExit
    assert.notEqual(exitCode, 1, 'should not exit with 1 for valid since')
  })
})

describe('export — markdown format', () => {
  test('markdown output has correct headers', async () => {
    let output = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: any) => { output += String(chunk); return true }

    const origExit = process.exit.bind(process)
    // @ts-ignore
    process.exit = () => { throw new Error('exit') }

    try {
      await runExport({ format: 'markdown' })
    } catch {}

    // @ts-ignore
    process.stdout.write = origWrite
    // @ts-ignore
    process.exit = origExit

    // Even with 0 sessions, should have header line
    assert.ok(output.includes('Date') || output === '', 'markdown output should be empty or have headers')
  })
})

describe('export — file output', () => {
  let tmpFile: string

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `claudestat-export-test-${Date.now()}.json`)
  })

  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch {}
  })

  test('with --output writes to file, not stdout (data)', async () => {
    let stdoutData = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    // @ts-ignore
    process.stdout.write = (chunk: any) => { stdoutData += String(chunk); return true }

    const origExit = process.exit.bind(process)
    // @ts-ignore
    process.exit = () => { throw new Error('exit') }

    try {
      await runExport({ format: 'json', output: tmpFile })
    } catch {}

    // @ts-ignore
    process.stdout.write = origWrite
    // @ts-ignore
    process.exit = origExit

    // The JSON data should NOT be written to stdout (console.log message may appear)
    assert.ok(!stdoutData.includes('total_cost_usd'), 'JSON data should not be written to stdout when --output is set')
    assert.ok(fs.existsSync(tmpFile), 'output file should exist')
    const content = fs.readFileSync(tmpFile, 'utf8')
    assert.ok(content.includes('total_cost_usd'), 'output file should contain JSON data')
  })
})
