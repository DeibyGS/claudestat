import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getWarnLevel, readConfig, validateConfig } from '../src/config'

describe('weeklyWarnThresholds — config defaults', () => {
  test('default weeklyWarnThresholds is [50, 75, 90]', () => {
    const cfg = readConfig()
    assert.deepStrictEqual(cfg.weeklyWarnThresholds, [50, 75, 90])
  })

  test('default resetReminderMins is 10', () => {
    const cfg = readConfig()
    assert.strictEqual(cfg.resetReminderMins, 10)
  })
})

describe('getWarnLevel — weekly thresholds', () => {
  const thresholds = [50, 75, 90]

  test('returns null below first threshold', () => {
    assert.strictEqual(getWarnLevel(49, thresholds), null)
  })

  test('returns yellow at first threshold', () => {
    assert.strictEqual(getWarnLevel(50, thresholds), 'yellow')
  })

  test('returns orange at second threshold', () => {
    assert.strictEqual(getWarnLevel(75, thresholds), 'orange')
  })

  test('returns red at third threshold', () => {
    assert.strictEqual(getWarnLevel(90, thresholds), 'red')
  })

  test('returns red above third threshold', () => {
    assert.strictEqual(getWarnLevel(100, thresholds), 'red')
  })
})

describe('validateConfig — new fields', () => {
  test('accepts valid weeklyWarnThresholds', () => {
    assert.strictEqual(validateConfig({ weeklyWarnThresholds: [50, 75, 90] }), null)
  })

  test('rejects weeklyWarnThresholds with wrong length', () => {
    const err = validateConfig({ weeklyWarnThresholds: [50, 75] })
    assert.ok(err !== null)
  })

  test('rejects weeklyWarnThresholds with out-of-range value', () => {
    const err = validateConfig({ weeklyWarnThresholds: [0, 75, 90] })
    assert.ok(err !== null)
  })

  test('accepts valid resetReminderMins', () => {
    assert.strictEqual(validateConfig({ resetReminderMins: 0 }), null)
    assert.strictEqual(validateConfig({ resetReminderMins: 10 }), null)
    assert.strictEqual(validateConfig({ resetReminderMins: 60 }), null)
  })

  test('rejects resetReminderMins out of range', () => {
    assert.ok(validateConfig({ resetReminderMins: -1 }) !== null)
    assert.ok(validateConfig({ resetReminderMins: 61 }) !== null)
  })

  test('rejects resetReminderMins non-number', () => {
    assert.ok(validateConfig({ resetReminderMins: '10' }) !== null)
  })
})
