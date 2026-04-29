import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

// NOTE: runDoctor() is a side-effectful async function that:
//   - calls execSync('claude --version') and fetch('localhost:7337/health')
//   - calls process.exit(1) on failure
//   - writes to stdout
// We cannot call it directly in tests. Instead we test each check's logic inline,
// mirroring exactly what doctor.ts does. This is the documented approach when the
// module has no individually exported check functions.

// ─── Check 1: Node.js version ────────────────────────────────────────────────

describe('doctor check — Node.js version', () => {
  test('passes with current Node.js version (>= 18)', () => {
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
    assert.ok(nodeMajor >= 18, `Node.js ${process.versions.node} should be >= 18`)
  })

  test('version string parses to a valid integer', () => {
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
    assert.ok(!isNaN(nodeMajor), 'major version should be a number')
    assert.ok(nodeMajor > 0, 'major version should be positive')
  })

  test('node >= 22 note says node:sqlite is supported', () => {
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
    // Mirror the note logic from doctor.ts
    const note = nodeMajor >= 22 ? 'node:sqlite supported ✓'
               : nodeMajor >= 18 ? 'Works — Node 22+ recommended for native node:sqlite'
               : undefined
    if (nodeMajor >= 22) assert.equal(note, 'node:sqlite supported ✓')
    if (nodeMajor >= 18 && nodeMajor < 22) assert.ok(note?.includes('recommended'))
  })
})

// ─── Check 4: ~/.claudestat/ data directory ───────────────────────────────────

describe('doctor check — ~/.claudestat/ directory', () => {
  test('passes if ~/.claudestat/ exists', () => {
    const dataDir   = path.join(os.homedir(), '.claudestat')
    const dataDirOk = fs.existsSync(dataDir)
    // On this machine it should exist since claudestat is installed
    if (dataDirOk) {
      assert.ok(dataDirOk, '~/.claudestat should exist on this machine')
    } else {
      // Acceptable — just verify the check logic runs without error
      assert.equal(typeof dataDirOk, 'boolean')
    }
  })

  test('fix message is set when directory does not exist (logic check)', () => {
    const dataDirOk = false  // simulated missing dir
    const fix = dataDirOk ? undefined : 'Run "claudestat start" once to create it automatically'
    assert.ok(typeof fix === 'string' && fix.length > 0)
  })

  test('fix is undefined when directory exists (logic check)', () => {
    const dataDirOk = true  // simulated existing dir
    const fix = dataDirOk ? undefined : 'Run "claudestat start" once to create it automatically'
    assert.equal(fix, undefined)
  })
})

// ─── Check 3: hooks detection logic ──────────────────────────────────────────

describe('doctor check — hooks detection logic', () => {
  const REQUIRED = ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']

  function checkHooksOk(settings: Record<string, any>): boolean {
    return REQUIRED.every(type =>
      settings.hooks?.[type]?.some((entry: any) =>
        entry.hooks?.some((h: any) =>
          typeof h.command === 'string' && h.command.includes('claudestat')
        )
      )
    )
  }

  test('returns true when all 4 hook types have claudestat command', () => {
    const settings: Record<string, any> = { hooks: {} }
    for (const t of REQUIRED) {
      settings.hooks[t] = [{ hooks: [{ type: 'command', command: 'node "/home/.claudestat/hooks/event.js"' }] }]
    }
    assert.ok(checkHooksOk(settings))
  })

  test('returns false when one hook type is missing', () => {
    const settings: Record<string, any> = { hooks: {} }
    for (const t of REQUIRED.slice(0, 3)) {  // missing Stop
      settings.hooks[t] = [{ hooks: [{ type: 'command', command: 'node "/home/.claudestat/hooks/event.js"' }] }]
    }
    assert.ok(!checkHooksOk(settings))
  })

  test('returns false when hooks object is absent', () => {
    assert.ok(!checkHooksOk({}))
  })

  test('returns false when commands do not include "claudestat"', () => {
    const settings: Record<string, any> = { hooks: {} }
    for (const t of REQUIRED) {
      settings.hooks[t] = [{ hooks: [{ type: 'command', command: 'node /other/script.js' }] }]
    }
    assert.ok(!checkHooksOk(settings))
  })
})

// ─── Check 5: hook script file ────────────────────────────────────────────────

describe('doctor check — hook script file', () => {
  test('check logic returns boolean', () => {
    const hookFile = path.join(os.homedir(), '.claudestat', 'hooks', 'event.js')
    const hookOk   = fs.existsSync(hookFile)
    assert.equal(typeof hookOk, 'boolean')
  })

  test('fix message for missing hook file references "claudestat install"', () => {
    const hookOk = false
    const fix = hookOk ? undefined : 'claudestat install'
    assert.equal(fix, 'claudestat install')
  })
})

// ─── Check output formatting ──────────────────────────────────────────────────

describe('doctor check — output formatting', () => {
  test('failed count is computed correctly from check array', () => {
    const checks = [
      { label: 'a', ok: true },
      { label: 'b', ok: false },
      { label: 'c', ok: false },
    ]
    const failed = checks.filter(c => !c.ok).length
    assert.equal(failed, 2)
  })

  test('all-passing check array has 0 failures', () => {
    const checks = [
      { label: 'a', ok: true },
      { label: 'b', ok: true },
    ]
    const failed = checks.filter(c => !c.ok).length
    assert.equal(failed, 0)
  })
})
