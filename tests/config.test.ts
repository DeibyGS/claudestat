import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { readConfig, writeConfig, validateConfig, getWarnLevel } from '../src/config'
import { getClaudestatDir } from '../src/paths'

// CONFIG_FILE must match what config.ts actually uses, which respects
// CLAUDESTAT_DATA_DIR (set to os.tmpdir() during tests via tests/index.ts).
const CONFIG_FILE = path.join(getClaudestatDir(), 'config.json')
let originalConfig: string | null = null

function backupConfig() {
  try { originalConfig = fs.readFileSync(CONFIG_FILE, 'utf8') } catch { originalConfig = null }
}

function restoreConfig() {
  if (originalConfig !== null) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, originalConfig)
  } else {
    try { fs.unlinkSync(CONFIG_FILE) } catch {}
  }
}

// ─── readConfig defaults ──────────────────────────────────────────────────────

describe('readConfig', () => {
  test('returns defaults when config file does not exist', () => {
    backupConfig()
    try {
      try { fs.unlinkSync(CONFIG_FILE) } catch {}
      const cfg = readConfig()
      assert.equal(cfg.killSwitchEnabled, false)
      assert.equal(cfg.killSwitchThreshold, 95)
      assert.deepEqual(cfg.warnThresholds, [70, 85, 95])
      assert.equal(cfg.plan, null)
      assert.equal(cfg.reportsEnabled, false)
      assert.equal(cfg.reportFrequency, 'weekly')
      assert.equal(cfg.reportDay, 1)
      assert.equal(cfg.reportTime, '09:00')
    } finally {
      restoreConfig()
    }
  })

  test('merges partial config with defaults correctly', () => {
    backupConfig()
    try {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ killSwitchEnabled: true, plan: 'pro' }))
      const cfg = readConfig()
      assert.equal(cfg.killSwitchEnabled, true)
      assert.equal(cfg.plan, 'pro')
      // Defaults still present for unset fields
      assert.equal(cfg.killSwitchThreshold, 95)
      assert.equal(cfg.reportsEnabled, false)
    } finally {
      restoreConfig()
    }
  })

  test('returns defaults when config file contains invalid JSON', () => {
    backupConfig()
    try {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
      fs.writeFileSync(CONFIG_FILE, 'not-valid-json{{{')
      const cfg = readConfig()
      assert.equal(cfg.killSwitchEnabled, false)
      assert.equal(cfg.killSwitchThreshold, 95)
    } finally {
      restoreConfig()
    }
  })
})

// ─── writeConfig ──────────────────────────────────────────────────────────────

describe('writeConfig', () => {
  test('writes config JSON correctly and readConfig retrieves it', () => {
    backupConfig()
    try {
      const cfg = readConfig()
      cfg.killSwitchEnabled = true
      cfg.killSwitchThreshold = 80
      cfg.plan = 'max5'
      writeConfig(cfg)

      const retrieved = readConfig()
      assert.equal(retrieved.killSwitchEnabled, true)
      assert.equal(retrieved.killSwitchThreshold, 80)
      assert.equal(retrieved.plan, 'max5')
    } finally {
      restoreConfig()
    }
  })

  test('written file is valid JSON with newline at end', () => {
    backupConfig()
    try {
      const cfg = readConfig()
      writeConfig(cfg)
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
      assert.doesNotThrow(() => JSON.parse(raw))
      assert.ok(raw.endsWith('\n'), 'file should end with newline')
    } finally {
      restoreConfig()
    }
  })
})

// ─── validateConfig ───────────────────────────────────────────────────────────

describe('validateConfig', () => {
  test('returns null for a valid full config object', () => {
    const result = validateConfig({
      killSwitchEnabled: true,
      killSwitchThreshold: 80,
      warnThresholds: [60, 75, 90],
      plan: 'pro',
      reportsEnabled: false,
      reportFrequency: 'weekly',
      reportDay: 1,
      reportTime: '09:00',
    })
    assert.equal(result, null)
  })

  test('returns error string when killSwitchEnabled is not boolean', () => {
    const result = validateConfig({ killSwitchEnabled: 'yes' })
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('returns error string when killSwitchThreshold is out of range', () => {
    const result = validateConfig({ killSwitchThreshold: 150 })
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('returns error string when warnThresholds has wrong length', () => {
    const result = validateConfig({ warnThresholds: [70, 85] })
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('returns error string for invalid plan', () => {
    const result = validateConfig({ plan: 'ultra' })
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('accepts null plan', () => {
    const result = validateConfig({ plan: null })
    assert.equal(result, null)
  })

  test('returns error when body is not an object', () => {
    const result = validateConfig('string-value')
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('returns error when reportTime has wrong format', () => {
    const result = validateConfig({ reportTime: '9:00' })
    assert.ok(typeof result === 'string' && result.length > 0)
  })

  test('loopThreshold validates range 2-50', () => {
    assert.equal(validateConfig({ loopThreshold: 1 }), 'loopThreshold must be an integer between 2 and 50')
    assert.equal(validateConfig({ loopThreshold: 51 }), 'loopThreshold must be an integer between 2 and 50')
    assert.equal(validateConfig({ loopThreshold: 1.5 }), 'loopThreshold must be an integer between 2 and 50')
    assert.equal(validateConfig({ loopThreshold: 8 }), null)
  })

  test('loopWindowSecs validates range 10-600', () => {
    assert.equal(validateConfig({ loopWindowSecs: 5 }), 'loopWindowSecs must be an integer between 10 and 600')
    assert.equal(validateConfig({ loopWindowSecs: 601 }), 'loopWindowSecs must be an integer between 10 and 600')
    assert.equal(validateConfig({ loopWindowSecs: 120 }), null)
  })

  test('webhookUrl validates http/https or null', () => {
    assert.ok(validateConfig({ webhookUrl: 'ftp://bad' }) !== null, 'should reject non-http URL')
    assert.equal(validateConfig({ webhookUrl: null }), null)
    assert.equal(validateConfig({ webhookUrl: 'https://hooks.slack.com/test' }), null)
    assert.equal(validateConfig({ webhookUrl: 'http://localhost/webhook' }), null)
  })

  test('projectAliases validates object shape', () => {
    assert.ok(validateConfig({ projectAliases: 'bad' }) !== null, 'should reject string')
    assert.ok(validateConfig({ projectAliases: [] }) !== null, 'should reject array')
    assert.equal(validateConfig({ projectAliases: {} }), null)
    assert.equal(validateConfig({ projectAliases: { '/path/to/repo': 'MyApp' } }), null)
  })
})

// ─── getWarnLevel ─────────────────────────────────────────────────────────────

describe('getWarnLevel', () => {
  const thresholds = [70, 85, 95]

  test('returns null when below all thresholds', () => {
    assert.equal(getWarnLevel(60, thresholds), null)
  })

  test('returns yellow when at first threshold', () => {
    assert.equal(getWarnLevel(70, thresholds), 'yellow')
  })

  test('returns orange when at second threshold', () => {
    assert.equal(getWarnLevel(85, thresholds), 'orange')
  })

  test('returns red when at or above third threshold', () => {
    assert.equal(getWarnLevel(95, thresholds), 'red')
    assert.equal(getWarnLevel(100, thresholds), 'red')
  })

  test('returns null for empty thresholds array', () => {
    assert.equal(getWarnLevel(99, []), null)
  })
})
