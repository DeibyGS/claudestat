#!/bin/bash

set -e

echo "Running claudestat tests..."

cd /Users/db/Documents/GitHub/claudestat

# Run the test suite using node:test
node --require tsx/cjs tests/index.ts

echo "All tests passed!"