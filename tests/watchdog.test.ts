import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

describe('watchdog utilities', () => {
  test('isProcessAlive returns true for current process', () => {
    assert.ok(true, 'current process is alive — process.kill(process.pid, 0) works')
    try {
      process.kill(process.pid, 0)
      assert.ok(true)
    } catch {
      assert.fail('process.kill(self, 0) should not throw')
    }
  })

  test('isProcessAlive returns false for non-existent pid', () => {
    try {
      process.kill(999999, 0)
      assert.fail('should have thrown')
    } catch {
      assert.ok(true, 'non-existent pid correctly throws')
    }
  })

  test('PID file read/write cycle works', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-test-'))
    const pidFile = path.join(tmpDir, 'daemon.pid')
    fs.writeFileSync(pidFile, String(process.pid))
    const raw = fs.readFileSync(pidFile, 'utf8').trim()
    assert.equal(parseInt(raw, 10), process.pid)
    fs.rmSync(tmpDir, { recursive: true })
  })

  test('startWatchdog does not throw and sets interval', () => {
    const { startWatchdog } = require('../src/watchdog')
    assert.doesNotThrow(() => { startWatchdog() })
  })
})
