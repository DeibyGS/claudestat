// tests/paths.test.ts — Cross-platform path resolution tests
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import os from 'os'

// Must import AFTER env vars are set (done in tests/index.ts)
import {
  getClaudeDir,
  getClaudestatDir,
  getPidFile,
  encodeClaudePath,
  homeSlugRegex,
  getHomeSlug,
  whichCmd,
  whichAllCmd,
  portCheckCmd,
  isWindows,
} from '../src/paths'

describe('getClaudeDir', () => {
  test('returns a valid path', () => {
    const dir = getClaudeDir()
    assert.ok(dir.length > 0)
    assert.ok(path.isAbsolute(dir))
  })

  test('on non-Windows, returns ~/.claude', () => {
    if (process.platform === 'win32') return
    assert.match(getClaudeDir(), /\.claude$/)
  })

  test('on Windows, returns ~/.claude', () => {
    if (process.platform !== 'win32') return
    assert.match(getClaudeDir(), /\.claude$/)
  })

  test('respects CLAUDE_DATA_DIR env override for claudestat dir', () => {
    const original = process.env.CLAUDESTAT_DATA_DIR
    process.env.CLAUDESTAT_DATA_DIR = '/custom/path'
    const dir = getClaudestatDir()
    assert.equal(dir, '/custom/path')
    if (original) process.env.CLAUDESTAT_DATA_DIR = original
    else delete process.env.CLAUDESTAT_DATA_DIR
  })
})

describe('getPidFile', () => {
  test('returns a path ending with daemon.pid', () => {
    const pidFile = getPidFile()
    assert.ok(pidFile.endsWith('daemon.pid'))
  })
})

describe('encodeClaudePath', () => {
  test('encodes Unix-style paths', () => {
    if (process.platform === 'win32') return
    const result = encodeClaudePath('/Users/db/Documents/GitHub/myproject')
    assert.ok(result.includes('-'))
    assert.ok(!result.includes('/'))
  })

  test('encodes Windows-style paths with drive letter', () => {
    if (process.platform !== 'win32') return
    // C:\Users\DGS → C--Users-DGS (colon becomes dash, backslash becomes dash)
    const result = encodeClaudePath('C:\\Users\\DGS')
    assert.equal(result, 'C--Users-DGS')
    assert.ok(!result.includes(':'))
    assert.ok(!result.includes('\\'))
  })

  test('encodes home directory correctly', () => {
    const homeDir = os.homedir()
    const encoded = encodeClaudePath(homeDir)
    assert.ok(!encoded.includes('/'))
    assert.ok(!encoded.includes('\\'))
    assert.ok(!encoded.includes(':'))
  })
})

describe('homeSlugRegex', () => {
  test('matches encoded home directory', () => {
    const homeDir = os.homedir()
    const encoded = encodeClaudePath(homeDir)
    const regex = homeSlugRegex()
    assert.ok(regex.test(encoded), `Regex should match ${encoded}`)
  })
})

describe('getHomeSlug', () => {
  test('returns non-empty string without path separators', () => {
    const slug = getHomeSlug()
    assert.ok(slug.length > 0)
    assert.ok(!slug.includes('/'))
    assert.ok(!slug.includes('\\'))
  })
})

describe('whichCmd', () => {
  test('returns a command containing the program name', () => {
    const cmd = whichCmd('node')
    assert.ok(cmd.includes('node'))
  })

  test('on Windows returns "where"', () => {
    if (process.platform !== 'win32') return
    assert.ok(whichCmd('node').startsWith('where'))
  })

  test('on Unix returns "which"', () => {
    if (process.platform === 'win32') return
    assert.ok(whichCmd('node').startsWith('which'))
  })
})

describe('portCheckCmd', () => {
  test('includes the port number', () => {
    const cmd = portCheckCmd(7337)
    assert.ok(cmd.includes('7337'))
  })

  test('on Windows uses netstat', () => {
    if (process.platform !== 'win32') return
    assert.ok(portCheckCmd(7337).includes('netstat'))
  })

  test('on Unix uses lsof', () => {
    if (process.platform === 'win32') return
    assert.ok(portCheckCmd(7337).includes('lsof'))
  })
})

describe('isWindows', () => {
  test('matches process.platform', () => {
    assert.equal(isWindows, process.platform === 'win32')
  })
})