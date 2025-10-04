import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface AutostartOptions {
  name: string // e.g., envhub-pg-16
  exec: string // executable absolute path
  args?: string[]
  logFile?: string
}

export function enableAutostartMac(opts: AutostartOptions): string {
  const plistDir = join(process.env.HOME || '', 'Library', 'LaunchAgents')
  const label = `com.${opts.name}`
  mkdirSync(plistDir, { recursive: true })
  const plistPath = join(plistDir, `${label}.plist`)
  const programArgs = [opts.exec, ...(opts.args || [])]
    .map((a) => `\n        <string>${escapeXml(a)}</string>`)
    .join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>${programArgs}\n    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${opts.logFile || '/tmp/' + opts.name + '.log'}</string>
    <key>StandardErrorPath</key>
    <string>${opts.logFile || '/tmp/' + opts.name + '.log'}</string>
  </dict>
</plist>`
  writeFileSync(plistPath, xml, 'utf8')
  return plistPath
}

export function enableAutostartWindows(opts: AutostartOptions): string {
  // Scheduled task on logon
  // Caller should execute the schtasks command with proper privileges when desired.
  // Here we simply return a recommended command string.
  const taskName = opts.name
  const args = (opts.args || []).map((a) => a.replace(/"/g, '""')).join(' ')
  const cmd = `schtasks /Create /SC ONLOGON /TN ${taskName} /TR "\"${opts.exec}\" ${args}" /RL HIGHEST /F`
  return cmd
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
