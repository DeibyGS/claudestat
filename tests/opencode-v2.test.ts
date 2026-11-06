import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-oc-v2-'))
const prevOpenCodeDb = process.env.OPENCODE_DB

function createV2Db(file: string) {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY, directory TEXT, model TEXT, cost REAL DEFAULT 0,
      tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
      time_created INTEGER, data TEXT
    );
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, model TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `)

  const now = Date.now()
  const t0 = now - 60_000
  db.prepare(`INSERT INTO session_v2 VALUES (?, ?, ?, 0, 100, 50, 1000, 10, ?, ?, NULL)`)
    .run('ses_v2_1', '/Users/test/projects/deep/app', JSON.stringify({ id: 'claude-sonnet-4-6' }), t0, now)

  db.prepare(`INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)`).run(
    'msg_u1', 'ses_v2_1', 'user', 1, t0,
    JSON.stringify({ time: { created: t0 }, text: 'hola mundo' })
  )

  const t1 = t0 + 1000
  db.prepare(`INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)`).run(
    'msg_a1', 'ses_v2_1', 'assistant', 2, t1,
    JSON.stringify({
      time: { created: t1, completed: t1 + 500 },
      content: [{
        type: 'tool', id: 'call_1', name: 'read', executed: true,
        state: { status: 'completed', input: { filePath: '/Users/test/projects/deep/app/a.ts' },
                 content: [{ type: 'text', text: 'file body' }] },
        time: { created: t1, ran: t1 + 10, completed: t1 + 110 },
      }],
      tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 1000, write: 10 } },
    })
  )

  const t2 = t1 + 60_000
  db.prepare(`INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)`).run(
    'msg_a2', 'ses_v2_1', 'assistant', 3, t2,
    JSON.stringify({
      time: { created: t2, completed: t2 + 300 },
      content: [{
        type: 'tool', id: 'call_2', name: 'write', executed: true,
        state: { status: 'completed', input: { filePath: '/Users/test/projects/deep/app/b.ts' },
                 content: [{ type: 'text', text: 'written' }] },
        time: { created: t2, ran: t2 + 5, completed: t2 + 205 },
      }],
      tokens: { input: 200, output: 60, reasoning: 0, cache: { read: 500, write: 0 } },
    })
  )

  db.close()
  return { now, t0, t1, t2 }
}

function createV1Db(file: string) {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, directory TEXT, model TEXT, cost REAL DEFAULT 0,
      tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `)

  const now = Date.now()
  const t0 = now - 60_000
  db.prepare(`INSERT INTO session VALUES (?, ?, ?, 0, 10, 5, 0, 0, ?, ?, NULL)`)
    .run('ses_v1_1', '/Users/test/projects/old/app', JSON.stringify({ id: 'claude-sonnet-4-6' }), t0, now)

  db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`).run(
    'm_u1', 'ses_v1_1', t0, t0, JSON.stringify({ role: 'user' })
  )
  db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`).run(
    'p_text', 'm_u1', 'ses_v1_1', t0, t0, JSON.stringify({ type: 'text', text: 'prompt v1' })
  )

  const t1 = t0 + 1000
  db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?)`).run(
    'm_a1', 'ses_v1_1', t1, t1 + 500, JSON.stringify({ role: 'assistant' })
  )
  db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`).run(
    'p_tool_1', 'm_a1', 'ses_v1_1', t1, t1 + 110,
    JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: '/Users/test/projects/old/app/a.ts' }, output: 'v1 body' } })
  )
  db.prepare(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`).run(
    'p_step', 'm_a1', 'ses_v1_1', t1 + 200, t1 + 200,
    JSON.stringify({ type: 'step-finish', tokens: { total: 1200, input: 10, output: 5, cache: { read: 1185, write: 0 } }, cost: 0 })
  )

  db.close()
  return { now, t0, t1 }
}

describe('opencode watcher — schema v2', () => {
  let v2File = ''

  before(() => {
    v2File = path.join(tmpDir, 'oc-v2.db')
    process.env.OPENCODE_DB = v2File
    createV2Db(v2File)
  })

  after(() => {
    if (prevOpenCodeDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOpenCodeDb
  })

  test('pollSessions reads session_v2 and returns the latest step as lastEntry', async () => {
    // en producción el enricher/sessions endpoint upserta la sesión (FK de events)
    const { dbOps } = require('../src/db')
    dbOps.upsertSession({ id: 'ses_v2_1', cwd: '/Users/test/projects/deep/app', started_at: Date.now() - 60_000, source: 'opencode' })

    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    assert.equal(sessions.length, 1)

    const s = sessions[0]
    assert.equal(s.sessionId, 'ses_v2_1')
    assert.equal(s.cwd, '/Users/test/projects/deep/app')
    assert.equal(s.cost.lastModel, 'claude-sonnet-4-6')
    assert.equal(s.cost.input_tokens, 100)
    assert.equal(s.cost.output_tokens, 50)

    // latest step = msg_a2: 200 + 60 + 0 (reasoning excluido del costo) ...
    assert.equal(s.cost.context_used, 200 + 60 + 0 + 500 + 0)
    assert.ok(s.cost.lastEntry, 'lastEntry should be emitted for the latest step')
    assert.ok(s.cost.lastEntry!.totalUsd > 0)
    assert.equal(s.cost.lastEntry!.inputTokens, 200 + 500 + 0)
  })

  test('pollSessions dedupes the same step across ticks', async () => {
    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].cost.lastEntry, undefined, 'same step must not re-emit block_cost')
    assert.ok(sessions[0].cost.context_used > 0, 'context_used still reported')
  })

  test('tool events imported from session_message content[]', () => {
    const { dbOps } = require('../src/db')
    const events = dbOps.getSessionEvents('ses_v2_1')
    const done = events.filter((e: { type: string; tool_name: string }) => e.type === 'Done')
    assert.equal(done.length, 2)
    assert.deepEqual(done.map((e: { tool_name: string }) => e.tool_name).sort(), ['read', 'write'])
    // external_id único por tool part (message_id#index)
    const ids = done.map((e: { external_id: string }) => e.external_id)
    assert.equal(new Set(ids).size, 2)
  })

  test('getAllStepFinishBlocksForSession returns one block per step', async () => {
    const { getAllStepFinishBlocksForSession } = require('../src/watchers/opencode')
    const blocks = await getAllStepFinishBlocksForSession('ses_v2_1')
    assert.equal(blocks.length, 2)
    assert.ok(blocks.every(b => b.totalUsd > 0))
    assert.equal(blocks[1].inputTokens, 200 + 500 + 0)
  })

  test('isSessionArchived uses session_v2', () => {
    const { isSessionArchived } = require('../src/watchers/opencode')
    assert.equal(isSessionArchived('ses_v2_1'), false)
    assert.equal(isSessionArchived('ses_missing'), true)
  })

  test('getOpencodeEvents builds trace from content[] (v2)', () => {
    const { getOpencodeEvents } = require('../src/routes/opencode-reader')
    const { events, prompts, totalParts } = getOpencodeEvents('ses_v2_1')

    assert.equal(prompts.length, 1)
    assert.equal(prompts[0].text, 'hola mundo')

    const done = events.filter(e => e.type === 'Done')
    const stops = events.filter(e => e.type === 'Stop')
    assert.equal(done.length, 2)
    assert.equal(stops.length, 1)
    assert.equal(totalParts, 2)

    assert.equal(done[0].tool_name, 'Read')
    assert.equal(done[0].tool_output, 'file body')
    assert.equal(done[0].duration_ms, 110)
    assert.equal(done[1].tool_name, 'Write')
    assert.equal(stops[0].ts, done[1].ts! + 205)
  })
})

describe('opencode watcher — schema v1 fallback', () => {
  before(() => {
    process.env.OPENCODE_DB = path.join(tmpDir, 'oc-v1.db')
    createV1Db(process.env.OPENCODE_DB)
  })

  after(() => {
    if (prevOpenCodeDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOpenCodeDb
  })

  test('pollSessions falls back to session/part when session_v2 is absent', async () => {
    const { dbOps } = require('../src/db')
    dbOps.upsertSession({ id: 'ses_v1_1', cwd: '/Users/test/projects/old/app', started_at: Date.now() - 60_000, source: 'opencode' })

    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    assert.equal(sessions.length, 1)

    const s = sessions[0]
    assert.equal(s.sessionId, 'ses_v1_1')
    assert.equal(s.cost.context_used, 1200)
    assert.ok(s.cost.lastEntry, 'step-finish v1 still produces lastEntry')
    assert.equal(s.cost.lastEntry!.inputTokens, 10 + 1185 + 0)
  })

  test('tool events imported from part table (v1)', () => {
    const { dbOps } = require('../src/db')
    const events = dbOps.getSessionEvents('ses_v1_1')
    const done = events.filter((e: { type: string }) => e.type === 'Done')
    assert.equal(done.length, 1)
    assert.equal(done[0].tool_name, 'read')
    assert.equal(done[0].external_id, 'p_tool_1')
  })

  test('getOpencodeEvents reads role + part table (v1)', () => {
    const { getOpencodeEvents } = require('../src/routes/opencode-reader')
    const { events, prompts, totalParts } = getOpencodeEvents('ses_v1_1')

    assert.equal(prompts.length, 1)
    assert.equal(prompts[0].text, 'prompt v1')
    assert.equal(totalParts, 2) // tool + step-finish (los parts de user no cuentan)

    const done = events.filter(e => e.type === 'Done')
    assert.equal(done.length, 1)
    assert.equal(done[0].tool_output, 'v1 body')
    assert.equal(done[0].duration_ms, 110)
  })
})
