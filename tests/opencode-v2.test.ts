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
    // session_v2.cost = 0 and the steps carry no cost → real $0 (S3: no Claude-rate estimate)
    assert.equal(s.cost.lastEntry!.totalUsd, 0)
    assert.equal(s.cost.billing, 'subscription')
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
    assert.ok(blocks.every(b => b.totalUsd === 0 && b.inputTokens > 0)) // real $0, tokens kept
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

// Each OpenCode provider/model has its own window: read it from OC's own
// models-dev catalog (kv 'models-dev:v2:catalog') instead of guessing.
describe('opencode watcher — context window from the models-dev catalog', () => {
  const catalogFile = path.join(tmpDir, 'oc-catalog.db')

  before(() => {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(catalogFile)
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY, directory TEXT, model TEXT, cost REAL DEFAULT 0,
        tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER
      );
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
    `)
    const body = JSON.stringify({
      openai:   { models: { 'gpt-x':  { limit: { context: 400_000, input: 272_000, output: 128_000 } } } },
      opencode: { models: { 'free-y': { limit: { context: 200_000, output: 128_000 } } } },
    })
    db.prepare(`INSERT INTO kv VALUES (?, ?)`).run('models-dev:v2:catalog', JSON.stringify({ updatedAt: 1, digest: 'd1', body }))
    db.prepare(`INSERT INTO kv VALUES (?, ?)`).run('models-dev:v2:catalog:meta', JSON.stringify({ updatedAt: 1, digest: 'd1' }))
    const now = Date.now()
    const insert = db.prepare(`INSERT INTO session_v2 VALUES (?, ?, ?, 0, 10, 5, 0, 0, ?, ?, NULL)`)
    insert.run('ses_cat_input',   '/Users/test/projects/cat/a', JSON.stringify({ id: 'gpt-x',  providerID: 'openai' }),   now - 3000, now - 3000)
    insert.run('ses_cat_context', '/Users/test/projects/cat/b', JSON.stringify({ id: 'free-y', providerID: 'opencode' }), now - 2000, now - 2000)
    insert.run('ses_cat_missing', '/Users/test/projects/cat/c', JSON.stringify({ id: 'claude-opus-4-8', providerID: 'anthropic' }), now - 1000, now - 1000)
    db.close()
    process.env.OPENCODE_DB = catalogFile
  })

  after(() => {
    if (prevOpenCodeDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOpenCodeDb
  })

  test('uses limit.input when present, else limit.context, else the Claude table', async () => {
    const { dbOps } = require('../src/db')
    for (const id of ['ses_cat_input', 'ses_cat_context', 'ses_cat_missing'])
      dbOps.upsertSession({ id, cwd: '/Users/test/projects/cat', started_at: Date.now() - 5000, source: 'opencode' })

    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    const win = (id: string) => sessions.find((s: { sessionId: string }) => s.sessionId === id)?.cost.context_window

    assert.equal(win('ses_cat_input'), 272_000)   // max prompt size, not the 400K total
    assert.equal(win('ses_cat_context'), 200_000)
    assert.equal(win('ses_cat_missing'), 967_000) // not in catalog → Claude table
  })
})

// S3 — OpenCode reports the real cost (0 on a subscription). The API price of
// the same tokens comes from OC's own catalog, never from a Sonnet estimate.
describe('opencode watcher — subscription vs API cost (S3)', () => {
  const billingFile = path.join(tmpDir, 'oc-billing.db')

  before(() => {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(billingFile)
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY, directory TEXT, model TEXT, cost REAL DEFAULT 0,
        tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER
      );
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
    `)
    const body = JSON.stringify({
      openai: { models: { 'gpt-x': {
        limit: { context: 400_000, input: 272_000 },
        // cache write as a per-TTL object, like the real catalog
        cost: { text: { input: { price: 2, cache: { read: 0.2, write: { '30m': 2.5, '12h': 5 } } }, output: { price: 10 } } },
      } } },
      opencode: { models: { 'free-y': {
        limit: { context: 200_000 },
        cost: { text: { input: { price: 0, cache: { read: 0 } }, output: { price: 0 } } },
      } } },
    })
    db.prepare(`INSERT INTO kv VALUES (?, ?)`).run('models-dev:v2:catalog', JSON.stringify({ updatedAt: 2, digest: 'd2', body }))
    db.prepare(`INSERT INTO kv VALUES (?, ?)`).run('models-dev:v2:catalog:meta', JSON.stringify({ updatedAt: 2, digest: 'd2' }))

    const now = Date.now()
    // tokens: 1M input, 100K output, 2M cache read, 0 cache write
    const insert = db.prepare(`INSERT INTO session_v2 VALUES (?, ?, ?, ?, 1000000, 100000, 2000000, 0, ?, ?, NULL)`)
    insert.run('ses_sub',     '/Users/test/projects/bill/a', JSON.stringify({ id: 'gpt-x', providerID: 'openai' }),   0,    now - 4000, now - 4000)
    insert.run('ses_api',     '/Users/test/projects/bill/b', JSON.stringify({ id: 'gpt-x', providerID: 'openai' }),   1.25, now - 3000, now - 3000)
    insert.run('ses_nocat',   '/Users/test/projects/bill/c', JSON.stringify({ id: 'mystery-1', providerID: 'acme' }), 0,    now - 2000, now - 2000)
    insert.run('ses_free',    '/Users/test/projects/bill/d', JSON.stringify({ id: 'free-y', providerID: 'opencode' }), 0,   now - 1000, now - 1000)
    // one step on the subscription session, with its own real cost (0)
    db.prepare(`INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)`).run(
      'msg_sub_1', 'ses_sub', 'assistant', 1, now - 4000,
      JSON.stringify({ cost: 0, tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }),
    )
    db.close()
    process.env.OPENCODE_DB = billingFile
  })

  after(() => {
    if (prevOpenCodeDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOpenCodeDb
  })

  test('cost 0 → subscription + catalog API equivalent; cost > 0 → api; missing → null; $0 model → free', async () => {
    const { dbOps } = require('../src/db')
    for (const id of ['ses_sub', 'ses_api', 'ses_nocat', 'ses_free'])
      dbOps.upsertSession({ id, cwd: '/Users/test/projects/bill', started_at: Date.now() - 5000, source: 'opencode' })

    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    const cost = (id: string) => sessions.find((s: { sessionId: string }) => s.sessionId === id)!.cost

    // 1M × $2 + 100K × $10 + 2M × $0.2 = 2 + 1 + 0.4
    assert.equal(cost('ses_sub').cost_usd, 0)
    assert.equal(cost('ses_sub').billing, 'subscription')
    assert.ok(Math.abs(cost('ses_sub').apiEquivalentUsd - 3.4) < 1e-9, String(cost('ses_sub').apiEquivalentUsd))

    assert.equal(cost('ses_api').cost_usd, 1.25)
    assert.equal(cost('ses_api').billing, 'api')

    assert.equal(cost('ses_nocat').cost_usd, 0)
    assert.equal(cost('ses_nocat').billing, 'subscription')
    assert.equal(cost('ses_nocat').apiEquivalentUsd, null)

    assert.equal(cost('ses_free').billing, 'free')
    assert.equal(cost('ses_free').apiEquivalentUsd, 0)

    // the live block of a subscription step is $0 real, with its API price alongside
    const block = cost('ses_sub').lastEntry
    assert.ok(block, 'subscription steps still emit a block')
    assert.equal(block.totalUsd, 0)
    assert.ok(Math.abs(block.apiEquivalentUsd - (1000 * 2 + 100 * 10) / 1e6) < 1e-12)
  })

  test('S8: provider is exposed from model.providerID (subscription vs API aware)', async () => {
    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    const provider = (id: string) => sessions.find((s: { sessionId: string }) => s.sessionId === id)!.cost.provider
    assert.equal(provider('ses_sub'),   'ChatGPT')
    assert.equal(provider('ses_api'),   'OpenAI API')
    assert.equal(provider('ses_free'),  'OpenCode Go/Zen')
    assert.equal(provider('ses_nocat'), 'acme')
  })

  test('S8: provider is persisted on the session', () => {
    const { dbOps } = require('../src/db')
    const { onCostUpdate } = require('../src/routes/events')
    onCostUpdate('ses_api', {
      input_tokens: 1, output_tokens: 1, cache_read: 0, cache_creation: 0, cost_usd: 1.25,
      context_used: 0, context_window: 0, billing: 'api', apiEquivalentUsd: 3.4, provider: 'OpenAI API',
    }, 'opencode')
    assert.equal(dbOps.getSession('ses_api').provider, 'OpenAI API')
  })

  test('billing and API equivalent are persisted on the session', () => {
    const { dbOps } = require('../src/db')
    const { onCostUpdate } = require('../src/routes/events')
    onCostUpdate('ses_sub', {
      input_tokens: 1, output_tokens: 1, cache_read: 0, cache_creation: 0, cost_usd: 0,
      context_used: 0, context_window: 0, billing: 'subscription', apiEquivalentUsd: 3.4,
    }, 'opencode')
    const row = dbOps.getSession('ses_sub')
    assert.equal(row.billing, 'subscription')
    assert.equal(row.api_equivalent_usd, 3.4)
  })
})

// ─── S9: OC session state and branch ─────────────────────────────────────────

describe('opencode watcher — state and branch (S9)', () => {
  const stateFile = path.join(tmpDir, 'oc-state.db')
  const gitDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-oc-git-'))
  const plainDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-oc-plain-'))

  before(() => {
    const { execSync } = require('child_process') as typeof import('child_process')
    execSync('git init -q -b feat/oc-state', { cwd: gitDir })
    // rev-parse needs a commit: an unborn branch has no HEAD to resolve
    execSync('git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init', { cwd: gitDir })

    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(stateFile)
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY, directory TEXT, model TEXT, cost REAL DEFAULT 0,
        tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER,
        time_busy INTEGER, time_idle INTEGER
      );
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT);
    `)
    const now = Date.now()
    const insert = db.prepare(`INSERT INTO session_v2 VALUES (?, ?, ?, 0, 10, 10, 0, 0, ?, ?, NULL, ?, ?)`)
    const model  = JSON.stringify({ id: 'gpt-x', providerID: 'openai' })
    insert.run('ses_busy',     gitDir,   model, now - 9000, now - 100, now - 500,  now - 2000)
    insert.run('ses_idle',     plainDir, model, now - 9000, now - 200, now - 3000, now - 1000)
    insert.run('ses_nullidle', plainDir, model, now - 9000, now - 300, now - 500,  null)
    db.close()
    process.env.OPENCODE_DB = stateFile
  })

  after(() => {
    if (prevOpenCodeDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevOpenCodeDb
  })

  test('time_busy > time_idle (or idle null) → working, else idle; branch from git, null outside a repo', async () => {
    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    const cost = (id: string) => sessions.find((s: { sessionId: string }) => s.sessionId === id)!.cost

    assert.equal(cost('ses_busy').ocState, 'working')
    assert.equal(cost('ses_idle').ocState, 'idle')
    assert.equal(cost('ses_nullidle').ocState, 'working')

    assert.equal(cost('ses_busy').gitBranch, 'feat/oc-state')
    assert.equal(cost('ses_idle').gitBranch, undefined)
  })

  test('the reported OC state wins only while the session is fresh', () => {
    const { ocLiveState, setOcLiveState } = require('../src/session-state')
    const now = Date.now()
    setOcLiveState('ses_fresh', 'working', now - 60_000)
    assert.equal(ocLiveState('ses_fresh', now), 'working')
    // OC killed while busy: time_idle never written → falls back to the event-derived state
    setOcLiveState('ses_crashed', 'working', now - 6 * 60_000)
    assert.equal(ocLiveState('ses_crashed', now), undefined)
    assert.equal(ocLiveState('ses_unknown', now), undefined)
  })

  test('branch is read only for live sessions, never for the backfill', async () => {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(stateFile)
    const old = Date.now() - 2 * 3_600_000
    db.prepare(`INSERT INTO session_v2 VALUES (?, ?, ?, 0, 10, 10, 0, 0, ?, ?, NULL, ?, ?)`)
      .run('ses_old', gitDir, JSON.stringify({ id: 'gpt-x', providerID: 'openai' }), old - 9000, old, old - 500, old)
    db.close()
    const { opencodeAdapter } = require('../src/watchers/opencode')
    const sessions = await opencodeAdapter.pollSessions(0)
    const old_ = sessions.find((s: { sessionId: string }) => s.sessionId === 'ses_old')
    assert.ok(old_, 'old session is still polled')
    assert.equal(old_.cost.gitBranch, undefined)
  })
})
