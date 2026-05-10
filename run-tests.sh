#!/bin/bash

set -e

echo "Running claudestat tests..."

# Use script's own directory for portability across CI environments
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Run the test suite using node:test
node --require tsx/cjs tests/index.ts

echo "All tests passed!"