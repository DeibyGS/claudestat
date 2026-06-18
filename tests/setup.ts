// Must run before any test imports db.ts (which has module-level side effects with node:sqlite)
process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()
