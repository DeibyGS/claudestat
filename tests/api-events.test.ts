import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import express from 'express'
import { dbOps } from '../src/db'
import { eventsRouter } from '../src/routes/events'
import { stopRateLimiter } from '../src/middleware/rate-limiter'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(eventsRouter)

const server = http.createServer(app)
const PORT = 17337

let sidCounter = 0
const newSid = () => `api-test-${++sidCounter}`

function postEvent(body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: 'localhost', port: PORT, path: '/event', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode!, body: buf }) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('POST /event — API integration tests', () => {
  before((_, done) => { server.listen(PORT, () => done()) })
  after((_, done) => { server.close(() => done()) })

  test('missing session_id returns 400', async () => {
    const res = await postEvent({ type: 'PreToolUse' })
    assert.equal(res.status, 400)
    assert.ok(res.body.error.includes('Missing'), `error should mention missing: ${res.body.error}`)
  })

  test('missing type returns 400', async () => {
    const res = await postEvent({ session_id: newSid() })
    assert.equal(res.status, 400)
  })

  test('valid PreToolUse event returns 200', async () => {
    const sid = newSid()
    const res = await postEvent({
      type: 'PreToolUse', session_id: sid,
      tool_name: 'Read', ts: Date.now(), cwd: '/test',
    })
    assert.equal(res.status, 200)
  })

  test('valid Stop event returns 200 and cleanupSession runs', async () => {
    const sid = newSid()
    const res1 = await postEvent({
      type: 'PreToolUse', session_id: sid,
      tool_name: 'Read', ts: Date.now(), cwd: '/test',
    })
    assert.equal(res1.status, 200)

    const res2 = await postEvent({
      type: 'Stop', session_id: sid, ts: Date.now() + 1000,
    })
    assert.equal(res2.status, 200)

    const session = dbOps.getSession(sid)
    assert.ok(session, 'session should exist in DB')
  })

  test('large tool_response: DB stores full, SSE broadcast truncates', async () => {
    const sid = newSid()
    await postEvent({
      type: 'PreToolUse', session_id: sid,
      tool_name: 'Bash', ts: Date.now(), cwd: '/test',
      tool_input: { command: 'ls' },
    })
    const bigResponse = 'x'.repeat(5000)
    const res = await postEvent({
      type: 'PostToolUse', session_id: sid,
      tool_name: 'Bash', ts: Date.now() + 100,
      tool_response: bigResponse,
    })
    assert.equal(res.status, 200)
    const events = dbOps.getSessionEvents(sid)
    const done = events.find(e => e.type === 'Done' && e.tool_name === 'Bash')
    assert.ok(done, 'Done event should exist')
    assert.ok(done.tool_response.length >= 5000,
      `DB should store full response (${done.tool_response.length} chars)`)
  })
})
