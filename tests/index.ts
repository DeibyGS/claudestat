// Test entry point — loads all test files in a single node process.
// Set env vars before any module loads (they have module-level side effects).
// IMPORTANT: use require() not import here — tsx/cjs (esbuild) hoists static
// imports above regular code, so process.env assignments would run AFTER
// db.ts loads and the DB would use a real file instead of :memory:.
process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

require('./paths.test')
require('./pattern-analyzer.test')
require('./db.test')
require('./config.test')
require('./quota-tracker.test')
require('./install.test')
require('./enricher.test')
require('./project-scanner.test')
require('./doctor.test')
