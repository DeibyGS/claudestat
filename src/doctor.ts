import fs            from 'fs'
import path          from 'path'
import os            from 'os'
import { execSync, spawnSync }  from 'child_process'
import { getClaudeDir, getClaudestatDir, whichCmd, whichAllCmd, isWindows } from './paths'
import { readConfig } from './config'
import { getOAuthAccessToken } from './claude-auth'

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
    ok:    nodeMajor >= 22,
    note:  nodeMajor >= 22 ? 'node:sqlite supported ✓' : undefined,
    fix:   nodeMajor < 22 ? 'Install Node.js 22 or later: https://nodejs.org' : undefined,
  })

  // 2. Claude Code installed
  const claudeOk = (() => { try { execSync('claude --version', { stdio: 'pipe' }); return true } catch { return false } })()
  checks.push({
    label: 'Claude Code installed',
    ok:    claudeOk,
    fix:   claudeOk ? undefined : 'npm install -g @anthropic-ai/claude-code',
  })

  // 3. Hooks wired into Claude Code settings
  const settingsPath = path.join(getClaudeDir(), 'settings.json')
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

  // 4. Data directory
  const dataDir    = getClaudestatDir()
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
  const cfgPort = readConfig().port
  const daemonOk = await (async () => { try { const res = await fetch(`http://localhost:${cfgPort}/health`); return res.ok } catch { return false } })()
  checks.push({
    label: 'Daemon running (localhost:' + cfgPort + ')',
    ok:    daemonOk,
    fix:   daemonOk ? undefined : 'claudestat start',
  })

  // 7. Global CLI symlink valid (no stale link from old installs)
  let symlinkOk = false
  let symlinkNote: string | undefined
  let activeBinary = ''
  try {
    activeBinary = execSync(whichCmd('claudestat'), { stdio: 'pipe' }).toString().trim()
    const realPath = fs.realpathSync(activeBinary)
    symlinkOk = fs.existsSync(realPath)
    if (!symlinkOk) symlinkNote = `Symlink points to missing file: ${realPath}`
  } catch {
    symlinkNote = 'claudestat not found in PATH'
  }
  checks.push({
    label: 'Global CLI symlink valid',
    ok:    symlinkOk,
    note:  symlinkNote,
    fix:   symlinkOk ? undefined : 'npm install -g @statforge/claudestat',
  })

  // 8. No duplicate claudestat binaries in PATH
  let duplicatesOk = true
  let duplicatesNote: string | undefined
  try {
    const allBinaries = execSync(whichAllCmd('claudestat'), { stdio: 'pipe' })
      .toString().trim().split('\n').filter(Boolean)
    if (allBinaries.length > 1) {
      duplicatesOk = false
      duplicatesNote = `Found ${allBinaries.length} binaries:\n${allBinaries.map(p => `         ${p}`).join('\n')}`
    }
  } catch {}
  checks.push({
    label: 'No duplicate claudestat binaries in PATH',
    ok:    duplicatesOk,
    note:  duplicatesNote,
    fix:   duplicatesOk ? undefined :
      `npm uninstall -g @statforge/claudestat && npm install -g @statforge/claudestat\n       Then restart your terminal or run: ${isWindows ? 'refreshenv' : 'hash -r claudestat'}`,
  })

  // 9. Active binary version matches installed package
  let versionOk = true
  let versionNote: string | undefined
  const installedVersion: string = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version }
    catch { return 'unknown' }
  })()
  if (activeBinary) {
    try {
      const runningVersion = execSync(`${activeBinary} --version`, { stdio: 'pipe' })
        .toString().split('\n')[0].trim().replace(/^v?/, '')
      versionOk = runningVersion === installedVersion
      if (!versionOk) {
        versionNote = `Active binary reports v${runningVersion}, installed package is v${installedVersion}`
      }
    } catch {}
  }
  checks.push({
    label: `Version match (installed: v${installedVersion})`,
    ok:    versionOk,
    note:  versionNote,
    fix:   versionOk ? undefined :
      `${isWindows ? 'refreshenv' : 'hash -r claudestat'}  (or restart terminal)\n       If persists: npm uninstall -g @statforge/claudestat && npm install -g @statforge/claudestat`,
  })

  // 10. NVM prefix sanity (only when NVM is active)
  if ((process.env.NVM_DIR || process.env.NVM_HOME) && activeBinary) {
    let nvmOk = true
    let nvmNote: string | undefined
    try {
      const npmPrefix = execSync('npm prefix -g', { stdio: 'pipe' }).toString().trim()
      if (!activeBinary.startsWith(npmPrefix)) {
        nvmOk = false
        nvmNote = `Binary at ${activeBinary}\n         Expected under: ${npmPrefix}/bin/`
      }
    } catch {}
    checks.push({
      label: 'NVM prefix matches active binary',
      ok:    nvmOk,
      note:  nvmNote,
      fix:   nvmOk ? undefined :
        `nvm use default && npm install -g @statforge/claudestat\n       Then restart terminal`,
    })
  }

  // 12. Daemon service node matches current node (only if service file exists)
  if (process.platform === 'darwin') {
    const plistPath = path.join(
      process.env.HOME ?? os.homedir(),
      'Library', 'LaunchAgents',
      'com.statforge.claudestat.plist'
    )
    if (fs.existsSync(plistPath)) {
      const plistContent = fs.readFileSync(plistPath, 'utf8')
      const currentNode  = process.execPath
      const nodeOk       = plistContent.includes(currentNode)
      checks.push({
        label: 'Daemon service uses current Node binary',
        ok:    nodeOk,
        note:  nodeOk ? undefined : `Service file uses a different node than ${currentNode}`,
        fix:   nodeOk ? undefined : 'claudestat setup --uninstall && claudestat setup',
      })
    }
  }

  // 11. MCP server registered in Claude Code
  let mcpOk = false
  let mcpNote: string | undefined
  const mcpResult = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 15000 })
  if (mcpResult.error) {
    mcpNote = '"claude" CLI not found — install Claude Code first'
  } else {
    const mcpList = (mcpResult.stdout ?? '') + (mcpResult.stderr ?? '')
    const mcpLine = mcpList.split('\n').find(l => l.includes('claudestat'))
    mcpOk = !!mcpLine && !mcpLine.includes('Failed') && !mcpLine.includes('✗')
    if (!mcpOk) mcpNote = 'Run "claudestat install" to register it automatically'
  }
  checks.push({
    label: 'MCP server registered in Claude Code',
    ok:    mcpOk,
    note:  mcpNote,
    fix:   mcpOk ? undefined : 'claudestat install',
  })

  // 12. Anthropic OAuth API accessible (for accurate weekly quota)
  let apiOk = false
  let apiNote: string | undefined
  try {
    const token = getOAuthAccessToken()
    if (!token) {
      apiNote = 'No OAuth token found — weekly quota will use JSONL estimation'
    } else {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      apiOk = res.ok
      if (!res.ok) apiNote = `HTTP ${res.status} — weekly quota will use JSONL estimation`
    }
  } catch (e) {
    apiNote = `Network error: ${e instanceof Error ? e.message : String(e)}`
  }
  checks.push({
    label: 'Anthropic OAuth API accessible',
    ok:    apiOk,
    note:  apiNote,
    fix:   apiOk ? undefined : 'Check network connection and OAuth token (claude auth status)',
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
    process.exit(0)
  } else {
    console.log(`  \x1b[31m${failed} check(s) failed — see fixes above\x1b[0m\n`)
    process.exit(1)
  }
}
