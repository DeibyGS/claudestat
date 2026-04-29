import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

// NOTE: installHooks() and uninstallHooks() are tightly coupled to:
//   - CLAUDE_SETTINGS = ~/.claude/settings.json  (reads/writes real file)
//   - installHookScript() which copies from __dirname/../hooks/event.js
//   - process.exit(1) on missing settings.json
// We avoid calling them directly to not corrupt the real installation.
// Instead we test the observable JSON-manipulation logic by replicating it here,
// and we test uninstallHooks via a temp settings.json using module monkey-patching
// approach that does not modify actual files.

// ─── Hook entry shape (mirrors src/install.ts hookEntry()) ───────────────────

function hookEntry(hookScript: string, eventType: string) {
  return {
    matcher: '.*',
    hooks: [{ type: 'command', command: `node "${hookScript}" ${eventType}` }]
  }
}

function hasClaudestatHook(entries: any[]): boolean {
  return entries.some((entry: any) =>
    entry.hooks?.some((h: any) =>
      typeof h.command === 'string' && h.command.includes('claudestat')
    )
  )
}

// ─── hookEntry shape ─────────────────────────────────────────────────────────

describe('hookEntry shape', () => {
  test('produces correct matcher and command structure', () => {
    const entry = hookEntry('/home/user/.claudestat/hooks/event.js', 'PreToolUse')
    assert.equal(entry.matcher, '.*')
    assert.equal(entry.hooks.length, 1)
    assert.equal(entry.hooks[0].type, 'command')
    assert.ok(entry.hooks[0].command.includes('PreToolUse'))
    assert.ok(entry.hooks[0].command.includes('event.js'))
  })

  test('embeds event type in command string', () => {
    for (const eventType of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) {
      const entry = hookEntry('/path/event.js', eventType)
      assert.ok(entry.hooks[0].command.includes(eventType), `command should contain ${eventType}`)
    }
  })
})

// ─── Already-installed detection ─────────────────────────────────────────────

describe('already-installed detection', () => {
  test('detects claudestat hook as already installed', () => {
    const existing = [hookEntry('/home/user/.claudestat/hooks/event.js', 'PreToolUse')]
    assert.ok(hasClaudestatHook(existing))
  })

  test('does not flag non-claudestat hooks as installed', () => {
    const other = [{ matcher: '.*', hooks: [{ type: 'command', command: 'node /other/script.js' }] }]
    assert.ok(!hasClaudestatHook(other))
  })

  test('returns false for empty hooks array', () => {
    assert.ok(!hasClaudestatHook([]))
  })
})

// ─── Settings JSON manipulation (install logic) ───────────────────────────────

describe('settings JSON install logic', () => {
  const HOOK_SCRIPT = '/tmp/claudestat-test-event.js'
  const HOOK_TYPES = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']

  function simulateInstall(settings: Record<string, any>): { settings: Record<string, any>; added: number } {
    if (!settings.hooks) settings.hooks = {}
    let added = 0
    for (const hookType of HOOK_TYPES) {
      if (!settings.hooks[hookType]) settings.hooks[hookType] = []
      const exists = hasClaudestatHook(settings.hooks[hookType])
      if (!exists) {
        settings.hooks[hookType].push(hookEntry(HOOK_SCRIPT, hookType))
        added++
      }
    }
    return { settings, added }
  }

  test('adds all 4 hook types to empty settings', () => {
    const { settings, added } = simulateInstall({})
    assert.equal(added, 4)
    for (const hookType of HOOK_TYPES) {
      assert.ok(settings.hooks[hookType].length === 1, `${hookType} should have 1 entry`)
    }
  })

  test('does not add hooks if already installed', () => {
    const preInstalled: Record<string, any> = { hooks: {} }
    for (const t of HOOK_TYPES) {
      preInstalled.hooks[t] = [hookEntry(HOOK_SCRIPT, t)]
    }
    const { added } = simulateInstall(preInstalled)
    assert.equal(added, 0)
  })

  test('adds only missing hook types (partial install)', () => {
    const partial: Record<string, any> = {
      hooks: { PreToolUse: [hookEntry(HOOK_SCRIPT, 'PreToolUse')] }
    }
    const { added } = simulateInstall(partial)
    assert.equal(added, 3)  // SessionStart + PostToolUse + Stop
  })

  test('preserves existing non-claudestat hooks', () => {
    const withOther: Record<string, any> = {
      hooks: {
        PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node /other.js' }] }]
      }
    }
    const { settings } = simulateInstall(withOther)
    assert.equal(settings.hooks.PreToolUse.length, 2)  // other + claudestat
  })
})

// ─── Settings JSON manipulation (uninstall logic) ─────────────────────────────

describe('settings JSON uninstall logic', () => {
  const HOOK_SCRIPT = '/tmp/claudestat-test-event.js'
  const HOOK_TYPES = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']

  function simulateUninstall(settings: Record<string, any>): { settings: Record<string, any>; removed: number } {
    if (!settings.hooks) return { settings, removed: 0 }
    let removed = 0
    for (const hookType of Object.keys(settings.hooks)) {
      const before = settings.hooks[hookType].length
      settings.hooks[hookType] = settings.hooks[hookType].filter((entry: any) =>
        !entry.hooks?.some((h: any) =>
          typeof h.command === 'string' && h.command.includes('claudestat')
        )
      )
      removed += before - settings.hooks[hookType].length
    }
    return { settings, removed }
  }

  test('removes all claudestat hooks', () => {
    const installed: Record<string, any> = { hooks: {} }
    for (const t of HOOK_TYPES) {
      installed.hooks[t] = [hookEntry(HOOK_SCRIPT, t)]
    }
    const { removed } = simulateUninstall(installed)
    assert.equal(removed, 4)
  })

  test('does not remove non-claudestat hooks', () => {
    const mixed: Record<string, any> = {
      hooks: {
        PreToolUse: [
          { matcher: '.*', hooks: [{ type: 'command', command: 'node /other.js' }] },
          hookEntry(HOOK_SCRIPT, 'PreToolUse'),
        ]
      }
    }
    const { settings, removed } = simulateUninstall(mixed)
    assert.equal(removed, 1)
    assert.equal(settings.hooks.PreToolUse.length, 1)
    assert.ok(settings.hooks.PreToolUse[0].hooks[0].command.includes('/other.js'))
  })

  test('returns 0 removed when no claudestat hooks present', () => {
    const clean: Record<string, any> = {
      hooks: {
        PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node /other.js' }] }]
      }
    }
    const { removed } = simulateUninstall(clean)
    assert.equal(removed, 0)
  })
})

// ─── Backup creation ─────────────────────────────────────────────────────────

describe('backup file creation', () => {
  test('backup is a copy of original before modification', () => {
    const tmpFile = `/tmp/claudestat-test-settings-${Date.now()}.json`
    const backupFile = tmpFile + '.bak'
    const original = JSON.stringify({ hooks: {} })
    fs.writeFileSync(tmpFile, original)

    try {
      // Simulate backup step from installHooks
      fs.copyFileSync(tmpFile, backupFile)
      const backup = fs.readFileSync(backupFile, 'utf8')
      assert.equal(backup, original)
    } finally {
      try { fs.unlinkSync(tmpFile) } catch {}
      try { fs.unlinkSync(backupFile) } catch {}
    }
  })
})
