// Test entry point — loads all test files in a single node process.
// Set env vars before any module loads (they have module-level side effects)
process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()

import './paths.test'
import './pattern-analyzer.test'
import './db.test'
import './config.test'
import './quota-tracker.test'
import './install.test'
import './enricher.test'
import './project-scanner.test'
import './doctor.test'
