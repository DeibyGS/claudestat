// Test entry point — loads all test files in a single node process.
// This avoids npm script && chains that can resolve to a different node version.
import './pattern-analyzer.test'
import './db.test'
import './config.test'
import './quota-tracker.test'
import './install.test'
import './enricher.test'
import './project-scanner.test'
import './doctor.test'
