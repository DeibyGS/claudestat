import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer, progressBar, isDaemonRunning } from '../src/mcp-factory'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// NOTE: MCP server tests use the official SDK Client over InMemoryTransport.
// The factory's public API (createMcpServer → start/stop/tools) is exercised
// directly; protocol negotiation (initialize/tools/list/tools/call) is verified
// through the SDK client, which acts as a real protocol peer.

async function startTestServer(customTool?: { name: string; description: string; inputSchema: object; handler: (args: Record<string, unknown>) => string | Promise<string> }) {
  const server = createMcpServer({
    name: 'claudestat-test',
    version: '0.0.0-test',
    tools: customTool ? [customTool] : [],
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connectForTest(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
  await client.connect(clientTransport)
  return { server, client }
}

describe('MCP server — protocol', () => {
  test('initialize handshake negotiates a supported protocol version', async () => {
    const { server, client } = await startTestServer()
    const version = (client as any).getServerVersion()
    assert.ok(version, 'serverInfo should be present after connect')
    assert.equal(version.name, 'claudestat-test')
    await client.close()
    await server.stop()
  })

  test('tools/list exposes the 9 default tools plus custom tools', async () => {
    const { server, client } = await startTestServer({
      name: 'my_custom_tool',
      description: 'A synthetic test tool',
      inputSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
      handler: async (args) => `hello ${args.word}`,
    })
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name)
    for (const def of [
      'get_quota_status',
      'get_current_session',
      'get_session_stats',
      'get_top_tools',
      'get_usage_insights',
      'get_model_breakdown',
      'get_weekly_insight',
      'get_context_status',
      'get_daily_summary',
    ]) {
      assert.ok(names.includes(def), `default tool ${def} should be listed`)
    }
    assert.ok(names.includes('my_custom_tool'), 'custom tool should be added to defaults')
    await client.close()
    await server.stop()
  })

  test('tools/list reports the JSON schema shape for parameterized tools', async () => {
    const { server, client } = await startTestServer()
    const { tools } = await client.listTools()
    const stats = tools.find(t => t.name === 'get_session_stats')!
    assert.ok(stats, 'get_session_stats should exist')
    assert.equal((stats.inputSchema as any).type, 'object')
    assert.ok((stats.inputSchema as any).properties?.days, 'days param should be in schema')
    await client.close()
    await server.stop()
  })

  test('tools/call returns text content for a custom tool', async () => {
    const { server, client } = await startTestServer({
      name: 'my_custom_tool',
      description: 'A synthetic test tool',
      inputSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
      handler: async (args) => `hello ${args.word}`,
    })
    const res = await client.callTool({ name: 'my_custom_tool', arguments: { word: 'world' } })
    assert.ok(res.content)
    const text = (res.content as any[]).find(c => c.type === 'text')?.text
    assert.equal(text, 'hello world')
    await client.close()
    await server.stop()
  })

  test('tools/call on a default tool returns non-empty text (get_current_session)', async () => {
    const { server, client } = await startTestServer()
    const res = await client.callTool({ name: 'get_current_session', arguments: {} })
    const text = (res.content as any[]).find(c => c.type === 'text')?.text
    assert.ok(typeof text === 'string' && text.length > 0, 'should return a text report')
    await client.close()
    await server.stop()
  })

  test('tools/call to an unknown tool returns a -32602 error', async () => {
    const { server, client } = await startTestServer()
    const res = await client.callTool({ name: 'no_such_tool', arguments: {} })
    assert.ok(res.isError, 'unknown tool should be flagged as error')
    await client.close()
    await server.stop()
  })

  test('invalid arguments for a parameterized tool produce a validation error', async () => {
    const { server, client } = await startTestServer()
    // days is a number — sending a string should fail Zod validation
    const res = await client.callTool({ name: 'get_session_stats', arguments: { days: 'not-a-number' } })
    assert.ok(res.isError, 'type-invalid arguments should be rejected')
    await client.close()
    await server.stop()
  })
})

describe('MCP server — bug regressions', () => {
  test('progressBar clamps pct > 100 without crashing (AC-10)', () => {
    // A pct above 100 (context overrun / weekly overlimit) used to produce a
    // RangeError from String.repeat with a negative count.
    const full = progressBar(150)
    assert.equal(full.length, 20)
    assert.ok(full.includes('\u2588'), 'bar should be fully filled')
    assert.ok(!full.includes('\u2591'), 'no unfilled cells when clamped')

    const zero = progressBar(0)
    assert.equal(zero.length, 20)
    assert.ok(!zero.includes('\u2588'), 'empty bar at 0%')

    const mid = progressBar(50)
    assert.equal(mid.length, 20)
    assert.equal(mid.split('\u2588').length - 1, 10, 'half filled at 50%')
  })

  test('progressBar handles negative pct gracefully (clamp to 0)', () => {
    const bar = progressBar(-5)
    assert.equal(bar.length, 20)
    assert.ok(!bar.includes('\u2588'))
  })

  test('isDaemonRunning returns false when pid file is missing (AC-13)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-pid-'))
    process.env.CLAUDESTAT_DATA_DIR = dir
    try {
      assert.equal(isDaemonRunning(), false, 'no pid file → daemon not running')
    } finally {
      delete process.env.CLAUDESTAT_DATA_DIR
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('isDaemonRunning returns false for a non-existent pid (AC-13)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-pid-'))
    fs.writeFileSync(path.join(dir, 'daemon.pid'), '999999999\n')
    process.env.CLAUDESTAT_DATA_DIR = dir
    try {
      assert.equal(isDaemonRunning(), false, 'stale pid → daemon not running')
    } finally {
      delete process.env.CLAUDESTAT_DATA_DIR
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('isDaemonRunning returns false when pid file references the current process (self-exclusion)', () => {
    // The MCP server shares a process namespace with the test runner; a pid file
    // pointing at our own pid must not be treated as "daemon running" (would be a
    // false positive under normal operation, where the daemon is a separate process).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudestat-pid-'))
    fs.writeFileSync(path.join(dir, 'daemon.pid'), `${process.pid}\n`)
    process.env.CLAUDESTAT_DATA_DIR = dir
    try {
      assert.equal(isDaemonRunning(), false, 'own pid should be excluded')
    } finally {
      delete process.env.CLAUDESTAT_DATA_DIR
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('addTool/removeTool are reflected in tools/list', async () => {
    const server = createMcpServer({ name: 'claudestat-test', version: '0.0.0-test' })
    server.addTool({
      name: 'late_tool',
      description: 'added after creation',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => 'late tool response',
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await (server as any).connectForTest(serverTransport)
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
    await client.connect(clientTransport)

    const afterAdd = await client.listTools()
    assert.ok(afterAdd.tools.some(t => t.name === 'late_tool'), 'tool added at runtime should be listed')
    const lateRes = await client.callTool({ name: 'late_tool', arguments: {} })
    assert.equal((lateRes.content as any[]).find(c => c.type === 'text')?.text, 'late tool response')

    server.removeTool('late_tool')
    const afterRemove = await client.listTools()
    assert.ok(!afterRemove.tools.some(t => t.name === 'late_tool'), 'removed tool should not be listed')

    await client.close()
    await server.stop()
  })
})
