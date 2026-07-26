#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && w.message.includes('SQLite')) return
  process.stderr.write(`${w.name}: ${w.message}\n`)
})

import { createMcpServer } from './mcp-factory'

const server = createMcpServer({ contextPolling: true })
server.start()

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
