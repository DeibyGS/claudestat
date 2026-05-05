# Test ClaudeStat on Windows

> **Purpose**: This document guides a Claude Code instance on Windows through cloning, building, and testing ClaudeStat to verify cross-platform compatibility. All changes were made and tested on macOS — Windows testing is the final validation step.

## Context

ClaudeStat v0.3.0 adds Windows compatibility. The core change is a new `src/paths.ts` module that centralizes all OS-specific path resolution:

- **macOS/Linux**: `~/.claude/` for Claude Code data
- **Windows**: `%APPDATA%/claude/` for Claude Code data
- **ClaudeStat data**: `~/.claudestat/` on all platforms (or `CLAUDESTAT_DATA_DIR` env var)

Other changes:
- `which` → `where` on Windows
- `lsof` → `netstat` on Windows
- `hash -r` → `refreshenv` on Windows
- `NVM_DIR` + `NVM_HOME` detection for nvm-windows
- `fs.chmodSync` skipped on Windows (no effect on NTFS)
- `process.env.HOME` replaced with `os.homedir()` everywhere
- Path encoding handles both `/` and `\` separators
- Test script uses `os.tmpdir()` instead of `/tmp`

152 tests pass on macOS. We need to verify they also pass on Windows and that the CLI works correctly.

---

## 1. Prerequisites

- **Node.js 22+** (required for `node:sqlite`)
- **Git** (to clone the repo)
- **Claude Code** installed (for integration tests with `install` and `doctor`)

Verify Node version:
```powershell
node --version
# Should show v22.x.x or higher
```

---

## 2. Setup

```powershell
git clone https://github.com/DeibyGS/claudestat.git
cd claudestat
npm install
```

### 2a. Build the project

```powershell
npm run build
```

**Expected**: TypeScript compiles without errors. You should see `dist/` directory created with `.js` files.

**If it fails**: Check the error output. Common issues:
- Missing `node:sqlite` module → you need Node 22+
- TypeScript errors → note the file and line number

### 2b. Build the dashboard (optional, for full testing)

```powershell
npm run build:dashboard
```

**Expected**: `dashboard/dist/` directory created. This may take a while due to `npm install` inside the dashboard.

---

## 3. Automatic Tests

```powershell
npm test
```

**Expected**: All 152 tests pass.

The test entry point (`tests/index.ts`) sets env vars before loading modules:
```typescript
process.env.CLAUDESTAT_DB_PATH ??= ':memory:'
process.env.CLAUDESTAT_DATA_DIR ??= require('os').tmpdir()
```

So tests work cross-platform without needing shell-specific env var syntax.

### What to check:

- [ ] All 152 tests pass
- [ ] `paths.test.ts` suite shows **8 suites** with correct results
- [ ] `getClaudeDir()` returns a path containing `claude` (on Windows, should include `AppData\Roaming`)
- [ ] `encodeClaudePath` tests pass (path separator handling)
- [ ] `whichCmd`/`whichAllCmd` tests pass (should return `where` on Windows)
- [ ] `portCheckCmd` tests pass (should return `netstat` on Windows)

### If tests fail:

1. Note the exact test name and error message
2. Check if the failure is in `paths.test.ts` (platform-specific) or elsewhere
3. Run a single test file for debugging:
   ```powershell
   $env:CLAUDESTAT_DB_PATH = ":memory:"
   $env:CLAUDESTAT_DATA_DIR = $env:TEMP
   node --require tsx/cjs tests/paths.test.ts
   ```

---

## 4. Manual Tests by Command

Run each command and verify the expected behavior.

### 4.1 `claudestat doctor`

```powershell
node dist\index.js doctor
```

**Expected output**: A checklist with checkmarks (✓) or crosses (✗) for each check.

**Critical verifications**:
- [ ] Check #3 "Hooks installed in Claude Code" — should look for `%APPDATA%\claude\settings.json` (NOT `~/.claude/settings.json`)
- [ ] Check #4 "~/.claudestat/ data directory exists" — should show path with `\` separators
- [ ] Check #7 "Global CLI symlink valid" — should use `where claudestat` (NOT `which`)
- [ ] Check #8 "No duplicate binaries in PATH" — should use `where claudestat`
- [ ] Check #10 "NVM prefix" — should detect `%NVM_HOME%` or `%NVM_DIR%`

**If doctor crashes**: Check the error stack trace. Most likely issue is a path resolution problem in `src/paths.ts`.

### 4.2 `claudestat start`

```powershell
node dist\index.js start
```

**Expected**:
- [ ] Daemon starts on `http://localhost:7337`
- [ ] PID file created at `%USERPROFILE%\.claudestat\daemon.pid`
- [ ] No errors about `HOME` being undefined
- [ ] `.claudestat` directory created at `%USERPROFILE%\.claudestat\`

**Test the daemon is running**:
```powershell
curl http://localhost:7337/health
# Expected: {"status":"ok","port":7337,"clients":0}
```

If `curl` is not available, open a browser to `http://localhost:7337/health`.

### 4.3 `claudestat watch`

Open a **second terminal** and run:
```powershell
node dist\index.js watch
```

**Expected**:
- [ ] Connects to the daemon and shows a live trace view
- [ ] ANSI colors render correctly (green checkmarks, red crosses)
- [ ] If colors look broken, try running in **Windows Terminal** (not cmd.exe)

### 4.4 `claudestat status`

```powershell
node dist\index.js status
```

**Expected**:
- [ ] Shows quota info, plan, and burn rate
- [ ] May show "Daemon is not running" if daemon isn't started — start it first

### 4.5 `claudestat install`

```powershell
node dist\index.js install
```

**Expected**:
- [ ] Reads `%APPDATA%\claude\settings.json`
- [ ] Creates backup at `%APPDATA%\claude\settings.json.bak`
- [ ] Adds 4 hook entries (SessionStart, PreToolUse, PostToolUse, Stop)
- [ ] Hook script copied to `%USERPROFILE%\.claudestat\hooks\event.js`
- [ ] **No `chmod` error** (chmod is skipped on Windows)

**Verify the settings file**:
```powershell
type "%APPDATA%\claude\settings.json"
```
Check that `claudestat` appears in the hooks section.

### 4.6 `claudestat uninstall`

```powershell
node dist\index.js uninstall
```

**Expected**:
- [ ] Removes all claudestat hooks from settings.json
- [ ] Reports "X hooks de claudestat eliminados"

### 4.7 `claudestat config`

```powershell
node dist\index.js config
```

**Expected**:
- [ ] Shows current config from `%USERPROFILE%\.claudestat\config.json`

```powershell
node dist\index.js config --kill-switch true
```

**Expected**:
- [ ] Updates config and saves it
- [ ] Shows "Config saved to ~/.claudestat/config.json"

### 4.8 `claudestat stop`

```powershell
node dist\index.js stop
```

**Expected**:
- [ ] Stops the daemon process
- [ ] Removes PID file
- [ ] Shows "claudestat daemon stopped (pid XXXX)"

**Note on Windows**: `SIGTERM` on Windows is equivalent to `SIGKILL` (forced termination). The daemon still cleans up via `process.on('exit')`, but it's less graceful than on Unix. This is a known Windows limitation.

---

## 5. Critical Path Verifications

These are the most important things to verify since they differ most between macOS and Windows.

### 5.1 Claude Code data directory

```powershell
node -e "const { getClaudeDir } = require('./dist/paths'); console.log('Claude dir:', getClaudeDir())"
```

**Expected on Windows**:
```
Claude dir: C:\Users\<YourUser>\AppData\Roaming\claude
```

- [ ] Path contains `AppData\Roaming\claude`
- [ ] Path uses `\` separators (Windows native)
- [ ] If Claude Code is installed, the directory exists and contains `settings.json`

### 5.2 ClaudeStat data directory

```powershell
node -e "const { getClaudestatDir } = require('./dist/paths'); console.log('Claudestat dir:', getClaudestatDir())"
```

**Expected on Windows**:
```
Claudestat dir: C:\Users\<YourUser>\.claudestat
```

- [ ] Path uses `\` separators
- [ ] Directory is created when daemon starts

### 5.3 Path encoding (Claude Code project paths)

```powershell
node -e "const { encodeClaudePath, getHomeSlug } = require('./dist/paths'); const home = require('os').homedir(); console.log('Home:', home); console.log('Encoded:', encodeClaudePath(home)); console.log('Slug:', getHomeSlug())"
```

**Expected on Windows** (for user `db` on drive `C:`):
```
Home: C:\Users\db
Encoded: -C--Users-db
Slug: -C--Users-db
```

- [ ] Backslashes are replaced with `-`
- [ ] Drive letter colon is stripped (`C:` → `C`)
- [ ] The slug matches what Claude Code actually uses for its project directory names

**CRITICAL CHECK**: Open `%APPDATA%\claude\projects\` and verify the directory names match the `encodeClaudePath` output for your home directory. If they don't match, `src/paths.ts` needs adjustment.

### 5.4 PID file path

```powershell
node -e "const { getPidFile } = require('./dist/paths'); console.log('PID file:', getPidFile())"
```

**Expected on Windows**:
```
PID file: C:\Users\<YourUser>\.claudestat\daemon.pid
```

- [ ] Uses `\` separators
- [ ] Points inside `.claudestat` directory

### 5.5 Platform commands

```powershell
node -e "const { whichCmd, whichAllCmd, portCheckCmd, isWindows } = require('./dist/paths'); console.log('isWindows:', isWindows); console.log('which:', whichCmd('node')); console.log('whichAll:', whichAllCmd('node')); console.log('portCheck:', portCheckCmd(7337))"
```

**Expected on Windows**:
```
isWindows: true
which: where node
whichAll: where node
portCheck: netstat -ano | findstr :7337
```

- [ ] `isWindows` is `true`
- [ ] `whichCmd` returns `where` command
- [ ] `portCheckCmd` returns `netstat` command

---

## 6. Integration Test with Claude Code

If you have Claude Code installed and configured on Windows:

### 6.1 Verify hooks work

1. Run `node dist\index.js install`
2. Start `node dist\index.js start`
3. Open Claude Code in another terminal
4. Use Claude Code normally (ask a question, use a tool)
5. Check the `watch` terminal — events should appear

- [ ] Events are received from hooks
- [ ] Project path is decoded correctly (shows real Windows path, not encoded)
- [ ] Cost tracking works (input/output tokens shown)

### 6.2 Dashboard test

1. Open `http://localhost:7337` in a browser
2. Verify the dashboard loads and shows:
   - [ ] Session list with project names
   - [ ] Trace panel with tool calls
   - [ ] Analytics view with charts
   - [ ] System config showing hooks and settings

---

## 7. Known Issues to Watch For

| Issue | Explanation | Severity |
|-------|-------------|----------|
| **ANSI colors in cmd.exe** | Classic Command Prompt doesn't support ANSI escape codes. Use Windows Terminal instead. | Low — workaround exists |
| **SIGTERM = SIGKILL on Windows** | `process.kill(pid, 'SIGTERM')` on Windows immediately kills the process without graceful shutdown. The `exit` handler still runs but it's less reliable. | Medium — daemon cleanup may be incomplete |
| **node:sqlite experimental warning** | Node 22+ shows `ExperimentalWarning: SQLite is an experimental feature`. This is suppressed in `index.ts` and is harmless. | None — already handled |
| **Path separator differences** | Some internal paths may show `\` on Windows instead of `/`. This is correct behavior — `path.join()` uses the native separator. | None — expected |
| **Claude Code path encoding** | The most critical unknown. Claude Code on Windows may encode project paths differently than we assumed. Verify section 5.3 carefully. | **High** — if encoding differs, project detection breaks |

---

## 8. Reporting Results

If something fails, create a GitHub issue at:
`https://github.com/DeibyGS/claudestat/issues`

Include:
1. **Windows version**: Run `ver` in cmd.exe or check Settings → System → About
2. **Node version**: `node --version`
3. **The exact command** that failed
4. **Full error output** (copy-paste the terminal output)
5. **What you expected** vs **what actually happened**
6. **Output of path verifications** from section 5 (especially 5.3)

### Quick diagnostic script

Run this and paste the full output:
```powershell
node -e "const p = require('./dist/paths'); const os = require('os'); console.log('=== ClaudeStat Windows Diagnostic ==='); console.log('Platform:', os.platform()); console.log('Node:', process.version); console.log('Home:', os.homedir()); console.log('Claude dir:', p.getClaudeDir()); console.log('Claudestat dir:', p.getClaudestatDir()); console.log('PID file:', p.getPidFile()); console.log('Home slug:', p.getHomeSlug()); console.log('Encoded home:', p.encodeClaudePath(os.homedir())); console.log('isWindows:', p.isWindows); console.log('which:', p.whichCmd('node')); console.log('portCheck:', p.portCheckCmd(7337)); console.log('APPDATA:', process.env.APPDATA); console.log('LOCALAPPDATA:', process.env.LOCALAPPDATA); console.log('NVM_DIR:', process.env.NVM_DIR || '(not set)'); console.log('NVM_HOME:', process.env.NVM_HOME || '(not set)'); try { const fs = require('fs'); const dir = p.getClaudeDir(); console.log('Claude dir exists:', fs.existsSync(dir)); if (fs.existsSync(dir)) { console.log('Claude dir contents:', fs.readdirSync(dir).join(', ')); } } catch(e) { console.log('Claude dir error:', e.message); }"
```

This gives us all the info needed to fix any issues found.

---

## 9. Success Criteria

ClaudeStat passes Windows validation when:

- [ ] `npm run build` compiles without errors
- [ ] `npm test` passes all 152 tests
- [ ] `claudestat doctor` runs and shows correct Windows paths
- [ ] `claudestat start` launches the daemon
- [ ] `claudestat install` modifies `%APPDATA%\claude\settings.json`
- [ ] Path encoding matches actual Claude Code project directories (section 5.3)
- [ ] Dashboard loads at `http://localhost:7337`

Once all checks pass, ClaudeStat is ready for v0.3.0 release with Windows support.