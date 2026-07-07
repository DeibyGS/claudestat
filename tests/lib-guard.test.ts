// tests/lib-guard.test.ts — Daemon guard unit tests for the public library API (v1.13.0)
//
// Validates AC-4 from spec.md:
//   - daemon down + default              → throws DaemonNotRunningError on first dbOps.* access
//   - daemon down + configure(opt-out)   → warn + proceeds
//   - daemon down + env=0                → warn + proceeds
//   - pure-module call without daemon    → no error (guard not invoked)
//
// Strategy: hit an unreachable port via CLAUDESTAT_DAEMON_PORT override (no mocking of readConfig).

import { test } from 'node:test'
import assert from 'node:assert/strict'

const UNREACHABLE_PORT = 1 // port 1 reserved but unused in practice; curl will fail fast

function freshImport(): Promise<typeof import('../src/lib')> {
  // Bust the module cache so each test starts with a fresh libConfig + daemonVerified state.
  // We delete by URL; tsx/cjs stores by absolute file path.
  const key = require.resolve('../src/lib')
  delete require.cache[key]
  const guardKey = require.resolve('../src/lib-guard')
  delete require.cache[guardKey]
  // Also bust config cache (lazy import in lib-guard) and db cache (side-effect-ful)
  const configKey = require.resolve('../src/config')
  delete require.cache[configKey]
  return Promise.resolve(require('../src/lib'))
}

test('AC-4 case 1: no daemon + default → throws DaemonNotRunningError', async () => {
  process.env.CLAUDESTAT_DAEMON_PORT = String(UNREACHABLE_PORT)
  delete process.env.CLAUDESTAT_LIB_THROW_ON_NO_DAEMON
  const lib = await freshImport()
  assert.throws(
    () => lib.dbOps.getAllSessions(),
    (err: unknown) => err instanceof Error && /daemon is not running/.test(err.message),
  )
})

test('AC-4 case 2: no daemon + configure({throwOnNoDaemon:false}) — warns + proceeds', async () => {
  process.env.CLAUDESTAT_DAEMON_PORT = String(UNREACHABLE_PORT)
  delete process.env.CLAUDESTAT_LIB_THROW_ON_NO_DAEMON
  const lib = await freshImport()
  lib.configure({ throwOnNoDaemon: false })

  // Suppress the expected console.warn from polluting test output
  const originalWarn = console.warn
  let warned = false
  console.warn = () => { warned = true }
  try {
    // Should NOT throw; either returns data or throws a different error (db.ts side-effect).
    // We only assert it bypasses the daemon guard.
    let bypassedGuard = false
    try {
      lib.dbOps.getAllSessions()
      bypassedGuard = true
    } catch (e) {
      bypassedGuard = !(e instanceof Error && /daemon is not running/.test((e as Error).message))
    }
    assert.equal(bypassedGuard, true, 'should not throw DaemonNotRunningError when opted out')
    assert.equal(warned, true, 'should have emitted a console.warn')
  } finally {
    console.warn = originalWarn
  }
})

test('AC-4 case 3: no daemon + CLAUDESTAT_LIB_THROW_ON_NO_DAEMON=0 — warns + proceeds', async () => {
  process.env.CLAUDESTAT_DAEMON_PORT = String(UNREACHABLE_PORT)
  process.env.CLAUDESTAT_LIB_THROW_ON_NO_DAEMON = '0'
  const lib = await freshImport()

  const originalWarn = console.warn
  let warned = false
  console.warn = () => { warned = true }
  try {
    let bypassedGuard = false
    try {
      lib.dbOps.getAllSessions()
      bypassedGuard = true
    } catch (e) {
      bypassedGuard = !(e instanceof Error && /daemon is not running/.test((e as Error).message))
    }
    assert.equal(bypassedGuard, true, 'should not throw DaemonNotRunningError with env=0')
    assert.equal(warned, true, 'should have emitted a console.warn')
  } finally {
    console.warn = originalWarn
  }
})

test('AC-4 case 4: pure-module call (analyzeSession) without daemon → no daemon-check error', async () => {
  process.env.CLAUDESTAT_DAEMON_PORT = String(UNREACHABLE_PORT)
  delete process.env.CLAUDESTAT_LIB_THROW_ON_NO_DAEMON
  const lib = await freshImport()

  // analyzeSession is a pure function — must NOT trigger the daemon guard
  // even though daemon is unreachable.
  const result = lib.analyzeSession([], 0)
  assert.ok(result, 'analyzeSession must return a report without throwing')
  assert.ok(typeof result === 'object', 'result must be an IntelligenceReport object')
})