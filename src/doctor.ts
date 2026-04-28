import fs            from 'fs'
import path          from 'path'
import os            from 'os'
import { execSync }  from 'child_process'

interface Check {
  label: string
  ok:    boolean
  note?: string
  fix?:  string
}

export async function runDoctor(): Promise<void> {
  const checks: Check[] = []
  const G = '\x1b[32m✓\x1b[0m'
  const R = '\x1b[31m✗\x1b[0m'
  const W = '\x1b[33m⚠\x1b[0m'

  // 1. Node.js version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
  checks.push({
    label: `Node.js version (${process.versions.node})`,
    ok:    nodeMajor >= 18,
    note:  nodeMajor >= 22 ? 'node:sqlite supported ✓'
         : nodeMajor >= 18 ? 'Works — Node 22+ recommended for native node:sqlite'
         : undefined,
    fix:   nodeMajor < 18 ? 'Install Node.js 18 or later: https://nodejs.org' : undefined,
  })

  // 2. Claude Code installed
  const claudeOk = (() => { try { execSync('claude --version', { stdio: 'pipe' }); return true } catch { return false } })()
  checks.push({
    label: 'Claude Code installed',
    ok:    claudeOk,
    fix:   claudeOk ? undefined : 'npm install -g @anthropic-ai/claude-code',
  })

  // 3. Hooks wired into ~/.claude/settings.json
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let hooksOk = false
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    const required  = ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']
    hooksOk = required.every(type =>
      settings.hooks?.[type]?.some((entry: any) =>
        entry.hooks?.some((h: any) =>
          typeof h.command === 'string' && h.command.includes('claudestat')
        )
      )
    )
  } catch {}
  checks.push({
    label: 'Hooks installed in Claude Code',
    ok:    hooksOk,
    note:  hooksOk ? undefined : `Expected hooks in ${settingsPath}`,
    fix:   hooksOk ? undefined : 'claudestat install',
  })

  // 4. ~/.claudestat/ data directory
  const dataDir    = path.join(os.homedir(), '.claudestat')
  const dataDirOk  = fs.existsSync(dataDir)
  checks.push({
    label: '~/.claudestat/ data directory exists',
    ok:    dataDirOk,
    fix:   dataDirOk ? undefined : 'Run "claudestat start" once to create it automatically',
  })

  // 5. Hook script deployed
  const hookFile  = path.join(dataDir, 'hooks', 'event.js')
  const hookOk    = fs.existsSync(hookFile)
  checks.push({
    label: 'Hook script deployed (~/.claudestat/hooks/event.js)',
    ok:    hookOk,
    fix:   hookOk ? undefined : 'claudestat install',
  })

  // 6. Daemon reachable
  const daemonOk = await (async () => { try { const res = await fetch('http://localhost:7337/health'); return res.ok } catch { return false } })()
  checks.push({
    label: 'Daemon running (localhost:7337)',
    ok:    daemonOk,
    fix:   daemonOk ? undefined : 'claudestat start',
  })

  // 7. Global CLI symlink valid (no stale link from old installs)
  let symlinkOk = false
  let symlinkNote: string | undefined
  try {
    const realPath = fs.realpathSync(execSync('which claudestat', { stdio: 'pipe' }).toString().trim())
    symlinkOk = fs.existsSync(realPath)
    if (!symlinkOk) symlinkNote = `Symlink points to missing file: ${realPath}`
  } catch {
    symlinkNote = 'claudestat not found in PATH'
  }
  checks.push({
    label: 'Global CLI symlink valid',
    ok:    symlinkOk,
    note:  symlinkNote,
    fix:   symlinkOk ? undefined : 'npm install -g @deibygs/claudestat',
  })

  // ── Print results ───────────────────────────────────────────
  console.log('\n🩺 claudestat doctor\n' + '─'.repeat(46))
  for (const c of checks) {
    console.log(`  ${c.ok ? G : R}  ${c.label}`)
    if (!c.ok) {
      if (c.note) console.log(`       ${W}  ${c.note}`)
      if (c.fix)  console.log(`       \x1b[36mfix:\x1b[0m  ${c.fix}`)
    }
  }
  console.log('─'.repeat(46))

  const failed = checks.filter(c => !c.ok).length
  if (failed === 0) {
    console.log('  \x1b[32mAll checks passed — claudestat is healthy!\x1b[0m\n')
  } else {
    console.log(`  \x1b[31m${failed} check(s) failed — see fixes above\x1b[0m\n`)
    process.exit(1)
  }
}
