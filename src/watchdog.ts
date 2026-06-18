import { spawn, type ChildProcess } from 'child_process'

const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000
let attempt = 0

function getBackoff(): number {
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS)
  attempt++
  return delay
}

function spawnDaemon(): ChildProcess {
  const env = { ...process.env, CLAUDESTAT_DAEMON: '1' }
  delete env.CLAUDESTAT_WATCHDOG
  const child = spawn(process.execPath, process.argv.slice(2), {
    stdio: 'inherit',
    env,
  })
  attempt = 0
  return child
}

export function startWatchdog(): void {
  let child = spawnDaemon()

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      process.exit(0)
    }
    const delay = getBackoff()
    console.error(`[watchdog] Daemon exited (code=${code}) — restarting in ${delay}ms`)
    setTimeout(() => { child = spawnDaemon() }, delay)
  })

  process.on('SIGTERM', () => { child.kill('SIGTERM') })
  process.on('SIGINT',  () => { child.kill('SIGINT')  })
}
