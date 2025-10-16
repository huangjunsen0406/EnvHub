import { execFileSync } from 'child_process'

export type OSKey = 'win' | 'mac'
export type ArchKey = 'x64' | 'arm64'
export type PlatformKey = 'win-x64' | 'darwin-x64' | 'darwin-arm64'

export interface DetectedPlatform {
  os: OSKey
  arch: ArchKey
  platformKey: PlatformKey
  isRosetta?: boolean
}

export function detectPlatform(): DetectedPlatform {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : null
  if (!os) {
    throw new Error(`Unsupported OS: ${process.platform}`)
  }
  const arch = (process.arch === 'arm64' ? 'arm64' : 'x64') as ArchKey

  let isRosetta = false
  if (os === 'mac' && arch === 'x64') {
    try {
      const out = execFileSync('sysctl', ['-in', 'sysctl.proc_translated'], {
        encoding: 'utf8'
      }).trim()
      isRosetta = out === '1'
    } catch {
      // ignore
    }
  }

  const platformKey: PlatformKey =
    os === 'win' ? 'win-x64' : arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'

  return { os, arch, platformKey, isRosetta }
}
