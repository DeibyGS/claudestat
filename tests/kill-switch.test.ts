import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import express from 'express'
import fs from 'fs'
import path from 'path'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

import { miscRouter } from '../src/routes/misc'

const app = express()
app.use(miscRouter)
const server = http.createServer(app)
let PORT = 0

const configPath = path.join(process.env.CLAUDESTAT_DATA_DIR!, 'config.json')

function getKillSwitch(): Promise<{ blocked: boolean; reason?: string; cyclePct?: number }> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path: '/kill-switch' }, res => {
      let buf = ''
      res.on('data', (c: Buffer) => { buf += c })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { reject(new Error(buf)) } })
    }).on('error', reject)
  })
}

describe('GET /kill-switch', () => {
  before((_, done) => { server.listen(0, () => { PORT = (server.address() as any).port; done() }) })
  after((_, done) => {
    try { fs.unlinkSync(configPath) } catch {}
    server.close(() => done())
  })

  test('response has boolean blocked property', async () => {
    const result = await getKillSwitch()
    assert.ok('blocked' in result, 'response must have blocked property')
    assert.equal(typeof result.blocked, 'boolean', 'blocked must be boolean')
  })

  test('blocked: false when killSwitchEnabled is false', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ killSwitchEnabled: false }))
    const result = await getKillSwitch()
    assert.equal(result.blocked, false, 'disabled kill switch should never block')
  })

  test('blocked: false when threshold exceeds max quota (101)', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ killSwitchEnabled: true, killSwitchThreshold: 101 }))
    const result = await getKillSwitch()
    assert.equal(result.blocked, false, 'threshold above 100% is unreachable')
  })

  test('cyclePct is a number when present', async () => {
    const result = await getKillSwitch()
    if ('cyclePct' in result) {
      assert.equal(typeof result.cyclePct, 'number', 'cyclePct must be a number')
      assert.ok(result.cyclePct! >= 0, 'cyclePct should be non-negative')
    }
  })
})
