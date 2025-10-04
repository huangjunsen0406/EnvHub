import { mkdirSync } from 'fs'
import { dirname, extname } from 'path'
import { spawn } from 'child_process'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: false })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const ext = extname(archivePath).toLowerCase()
  if (ext === '.zip') {
    if (process.platform === 'win32') {
      // Use PowerShell Expand-Archive on Windows
      const cmd = 'powershell'
      const args = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`
      ]
      await run(cmd, args)
    } else {
      await run('unzip', ['-o', archivePath, '-d', destDir])
    }
    return
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await run('tar', ['-xzf', archivePath, '-C', destDir])
    return
  }
  if (archivePath.endsWith('.tar')) {
    await run('tar', ['-xf', archivePath, '-C', destDir])
    return
  }
  throw new Error(`Unsupported archive format: ${archivePath}`)
}

export async function removeQuarantineAttr(targetDir: string): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await run('xattr', ['-dr', 'com.apple.quarantine', targetDir])
    } catch {
      // ignore
    }
  }
}
