import { execSync } from 'child_process'
import os from 'os'

export function sendDesktopNotification(title: string, body: string): void {
  try {
    if (os.platform() === 'darwin') {
      const escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      execSync(`osascript -e 'display notification "${escaped}" with title "${title}"'`, { stdio: 'ignore' })
    } else if (os.platform() === 'linux') {
      execSync(`notify-send "${title}" "${body}"`, { stdio: 'ignore' })
    }
  } catch {
    // notification not available — already logged to console
  }
}
