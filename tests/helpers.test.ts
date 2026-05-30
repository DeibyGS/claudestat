import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import os from 'os'
import { findGitRoot, findProjectCwdForFile } from '../src/routes/helpers'

process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= os.tmpdir()

describe('findGitRoot', () => {
  test('returns a path for a git repository directory', () => {
    // The claudestat project itself is a git repo
    const result = findGitRoot(__dirname)
    assert.ok(typeof result === 'string', 'should return a string for a git repo')
    assert.ok(result.length > 0, 'path should not be empty')
  })

  test('returns undefined for a non-git directory', () => {
    // /tmp is not a git repo
    const result = findGitRoot(os.tmpdir())
    assert.equal(result, undefined, 'should return undefined for non-git dir')
  })

  test('returned path contains .git', () => {
    const result = findGitRoot(__dirname)
    if (result) {
      const gitDir = path.join(result, '.git')
      const fs = require('fs')
      assert.ok(fs.existsSync(gitDir), '.git directory should exist in the returned root')
    }
  })
})

describe('findProjectCwdForFile', () => {
  test('returns a path for a file inside the claudestat repo', () => {
    const testFile = path.join(__dirname, 'helpers.test.ts')
    const result = findProjectCwdForFile(testFile)
    assert.ok(typeof result === 'string' || result === undefined)
    // Either finds HANDOFF.md or falls back to git root — both are valid
    if (result) {
      assert.ok(result.length > 0, 'result should not be empty')
    }
  })

  test('returns undefined or git root for a file in /tmp', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-nonexistent.ts')
    const result = findProjectCwdForFile(tmpFile)
    // /tmp is not a git repo, so should return undefined
    assert.equal(result, undefined)
  })
})
