import { execSync } from 'child_process'
import os from 'os'

export function sendDesktopNotification(title: string, body: string): void {
  try {
    const platform = os.platform()

    if (platform === 'darwin') {
      const t = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const b = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      execSync(`osascript -e 'display notification "${b}" with title "${t}"'`, { stdio: 'ignore', timeout: 5000 })

    } else if (platform === 'linux') {
      execSync(`notify-send "${title}" "${body}"`, { stdio: 'ignore', timeout: 5000 })

    } else if (platform === 'win32') {
      // UTF-16LE base64-encoded PowerShell to handle any special characters safely
      const script = [
        `Add-Type -AssemblyName System.Windows.Forms`,
        `$n = New-Object System.Windows.Forms.NotifyIcon`,
        `$n.Icon = [System.Drawing.SystemIcons]::Information`,
        `$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info`,
        `$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'`,
        `$n.BalloonTipText  = '${body.replace(/'/g, "''")}'`,
        `$n.Visible = $true`,
        `$n.ShowBalloonTip(5000)`,
        `Start-Sleep -Milliseconds 200`,
      ].join('; ')
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { stdio: 'ignore', timeout: 8000 })
    }
  } catch {
    // notification unavailable — silent fallback
  }
}
