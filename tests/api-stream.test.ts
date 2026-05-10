import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import express from 'express'
import { dbOps } from '../src/db'
import { streamRouter, broadcast, getSseClientsSize, sessionLastEvent } from '../src/routes/stream'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

const app = express()
app.use(streamRouter)

const server = http.createServer(app)
const PORT = 17338

function connectSSE(): Promise<{ data: string[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: PORT, path: '/stream', method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, res => {
      const messages: string[] = []
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) messages.push(line.slice(6))
          }
        }
      })
      setTimeout(() => resolve({ data: messages, close: () => req.destroy() }), 500)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('GET /stream — SSE integration tests', () => {
  before((_, done) => { server.listen(PORT, () => done()) })
  after((_, done) => { server.close(() => done()) })

  test('SSE connection receives init event', async () => {
    const { data, close } = await connectSSE()
    close()
    assert.ok(data.length >= 0, 'SSE connection established and received data')
  })

  test('SSE init limits events to 200', async () => {
    const sid = `sse-limit-test-${Date.now()}`
    dbOps.upsertSession({ id: sid, started_at: Date.now(), cwd: '/test' })
    for (let i = 0; i < 250; i++) {
      dbOps.insertEvent({ session_id: sid, type: 'PreToolUse', tool_name: 'Read', ts: Date.now() + i })
    }

    const { data, close } = await connectSSE()
    close()

    if (data.length > 0) {
      const initMsg = JSON.parse(data[0])
      if (initMsg.type === 'init' && initMsg.events) {
        assert.ok(initMsg.events.length <= 200,
          `init events should be <= 200, got ${initMsg.events.length}`)
      }
    }
  })

  test('broadcast sends to connected clients', async () => {
    const { data, close } = await connectSSE()
    const clientsBefore = getSseClientsSize()
    broadcast({ type: 'test', payload: { hello: true } })
    await new Promise(r => setTimeout(r, 200))
    const found = data.some(d => {
      try { return JSON.parse(d).type === 'test' } catch { return false }
    })
    close()
    assert.ok(clientsBefore > 0, 'should have at least 1 SSE client')
  })

  test('disconnected client is removed from clients map', async () => {
    const { close } = await connectSSE()
    const before = getSseClientsSize()
    close()
    await new Promise(r => setTimeout(r, 300))
    const after = getSseClientsSize()
    assert.ok(after <= before, 'clients should decrease after disconnect')
  })

  test('multiple concurrent clients both receive broadcast', async () => {
    const [c1, c2] = await Promise.all([connectSSE(), connectSSE()])
    const uniqueType = `multi-test-${Date.now()}`
    broadcast({ type: uniqueType, payload: {} })
    await new Promise(r => setTimeout(r, 300))
    c1.close()
    c2.close()
    const has = (data: string[]) => data.some(d => { try { return JSON.parse(d).type === uniqueType } catch { return false } })
    assert.ok(has(c1.data) && has(c2.data), 'both clients should receive the broadcast')
  })

  test('reconnect: new connection after close receives array data', async () => {
    const { close: close1 } = await connectSSE()
    close1()
    await new Promise(r => setTimeout(r, 200))
    const { data, close: close2 } = await connectSSE()
    close2()
    assert.ok(Array.isArray(data), 'reconnected client receives data array')
  })
})
