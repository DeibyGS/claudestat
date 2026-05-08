import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimited, stopRateLimiter } from '../src/middleware/rate-limiter'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

describe('isRateLimited', () => {
  test('first request from IP is not limited', () => {
    const result = isRateLimited('10.0.0.1')
    assert.equal(result, false)
  })

  test('120 requests within window are not limited', () => {
    for (let i = 0; i < 119; i++) {
      isRateLimited('10.0.0.2')
    }
    assert.equal(isRateLimited('10.0.0.2'), false)
  })

  test('121st request within window is limited', () => {
    for (let i = 0; i < 120; i++) {
      isRateLimited('10.0.0.3')
    }
    assert.equal(isRateLimited('10.0.0.3'), true)
  })

  test('different IPs have independent limits', () => {
    for (let i = 0; i < 120; i++) {
      isRateLimited('10.0.0.4')
    }
    assert.equal(isRateLimited('10.0.0.5'), false, 'different IP should not be limited')
  })

  test('stopRateLimiter clears the map', () => {
    for (let i = 0; i < 50; i++) {
      isRateLimited('10.0.0.6')
    }
    stopRateLimiter()
    assert.equal(isRateLimited('10.0.0.6'), false, 'after stop, IP should start fresh')
  })
})
