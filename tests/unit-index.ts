// Unit tests entry — pure logic, no DB/API/heavy I/O
process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

require('./alerts.test')
require('./config.test')
require('./helpers.test')
require('./insights.test')
require('./paths.test')
require('./pattern-analyzer.test')
require('./rate-limiter.test')
require('./session-state.test')
require('./share.test')
