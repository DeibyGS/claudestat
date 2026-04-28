// Test entry point — loads all test files in a single node process.
// This avoids npm script && chains that can resolve to a different node version.
import './pattern-analyzer.test'
import './db.test'
