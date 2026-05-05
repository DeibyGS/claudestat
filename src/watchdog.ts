/**
 * watchdog.ts — Daemon auto-restart mechanism
 *
 * If the daemon process crashes or is killed unexpectedly, the watchdog
 * detects the stale PID file and relaunches the daemon automatically.
 *
 * Usage: `claudestat start --watchdog`
 * The watchdog runs as a separate lightweight process that periodically
 * checks if the daemon PID is still alive.
 */

import fs from 'fs'
import { spawn } from 'child_process'
import { getPidFile } from './paths'

const PID_FILE = getPidFile()
const CHECK_INTERVAL_MS = 10_000
const RESTART_COOLDOWN_MS = 30_000

let lastRestart = 0

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim()
    const pid = parseInt(raw, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function restartDaemon() {
  const now = Date.now()
  if (now - lastRestart < RESTART_COOLDOWN_MS) return
  lastRestart = now

  console.log(`[watchdog] Daemon not running — restarting...`)

  const child = spawn(process.execPath, [process.argv[1] ?? 'claudestat', 'start'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  console.log(`[watchdog] Daemon restarted (pid ${child.pid})`)
}

export function startWatchdog() {
  console.log(`[watchdog] Starting — monitoring daemon every ${CHECK_INTERVAL_MS / 1000}s`)

  const interval = setInterval(() => {
    const pid = readPid()
    if (pid === null) {
      restartDaemon()
      return
    }
    if (!isProcessAlive(pid)) {
      console.log(`[watchdog] Daemon pid ${pid} is dead`)
      try { fs.unlinkSync(PID_FILE) } catch {}
      restartDaemon()
    }
  }, CHECK_INTERVAL_MS)

  process.on('SIGTERM', () => { clearInterval(interval); process.exit(0) })
  process.on('SIGINT',  () => { clearInterval(interval); process.exit(0) })
}
