import fs   from 'fs'
import path from 'path'
import { execSync } from 'child_process'

function buildEnvPath(): string {
  const current = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'
  const nvmDir  = process.env.NVM_DIR
  if (!nvmDir) return current
  const nvmBin = path.join(nvmDir, 'versions', 'node', `v${process.versions.node}`, 'bin')
  return current.includes(nvmBin) ? current : `${nvmBin}:${current}`
}

const PLIST_LABEL = 'com.statforge.claudestat'
const PLIST_PATH  = path.join(
  process.env.HOME ?? '~',
  'Library', 'LaunchAgents',
  `${PLIST_LABEL}.plist`
)
const SYSTEMD_DIR  = path.join(process.env.HOME ?? '~', '.config', 'systemd', 'user')
const SYSTEMD_PATH = path.join(SYSTEMD_DIR, 'claudestat.service')

function isBinary(): boolean {
  return process.argv[1]?.includes('claudestat') && !process.argv[1]?.includes('node_modules')
    && !process.argv[1]?.includes('dist/index.js')
}

function serviceCommand(): string {
  if (isBinary()) return process.argv[1]
  return `${process.execPath} ${process.argv[1]}`
}

function makePlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${serviceCommand()}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDESTAT_DAEMON</key>
    <string>1</string>
    <key>PATH</key>
    <string>${buildEnvPath()}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/claudestat-daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claudestat-daemon.err</string>
</dict>
</plist>`
}

function makeUnit(): string {
  return `[Unit]
Description=ClaudeStat daemon — real-time Claude Code monitor
After=default.target

[Service]
Type=simple
ExecStart=${serviceCommand()} start
Restart=on-failure
RestartSec=5
Environment=CLAUDESTAT_DAEMON=1
Environment=PATH=${buildEnvPath()}

[Install]
WantedBy=default.target`
}

export function installService(): void {
  if (process.platform === 'darwin') {
    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true })
    try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'ignore' }) } catch {}
    fs.writeFileSync(PLIST_PATH, makePlist())
    execSync(`launchctl load "${PLIST_PATH}"`)
    console.log(`   service  → ${PLIST_PATH}`)
    console.log(`   node     → ${process.execPath}`)
  } else if (process.platform === 'linux') {
    const hasSystemd = (() => {
      try { execSync('which systemctl', { stdio: 'pipe' }); return true } catch { return false }
    })()
    if (!hasSystemd) {
      console.log('   systemd not found — run `claudestat start` manually to start the daemon')
      return
    }
    fs.mkdirSync(SYSTEMD_DIR, { recursive: true })
    fs.writeFileSync(SYSTEMD_PATH, makeUnit())
    execSync('systemctl --user daemon-reload')
    execSync('systemctl --user enable --now claudestat')
    console.log(`   service  → ${SYSTEMD_PATH}`)
    console.log(`   node     → ${process.execPath}`)
  } else {
    console.log('   Auto-start on Windows coming soon. Run `claudestat start` manually.')
  }
}

export function uninstallService(): void {
  if (process.platform === 'darwin') {
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'ignore' })
    } catch {}
    try {
      fs.unlinkSync(PLIST_PATH)
      console.log(`   removed  → ${PLIST_PATH}`)
    } catch {
      console.log('   service file not found (already removed)')
    }
  } else if (process.platform === 'linux') {
    try {
      execSync('systemctl --user disable --now claudestat 2>/dev/null', { stdio: 'ignore' })
    } catch {}
    try {
      fs.unlinkSync(SYSTEMD_PATH)
      execSync('systemctl --user daemon-reload')
      console.log(`   removed  → ${SYSTEMD_PATH}`)
    } catch {
      console.log('   service file not found (already removed)')
    }
  }
}
