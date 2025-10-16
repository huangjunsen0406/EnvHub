import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { shimsDir } from '../core/paths'

/**
 * 检查 PATH 中是否已包含 shims 目录
 */
export function isPathConfigured(): boolean {
  const shims = shimsDir()
  if (process.platform === 'win32') {
    return checkWindowsPath(shims)
  } else {
    return checkUnixPath(shims)
  }
}

/**
 * 添加 shims 到 PATH
 */
export async function addToPath(): Promise<string> {
  const shims = shimsDir()
  if (process.platform === 'win32') {
    return addToWindowsPath(shims)
  } else {
    return addToUnixPath(shims)
  }
}

/**
 * 从 PATH 移除 shims
 */
export async function removeFromPath(): Promise<string> {
  const shims = shimsDir()
  if (process.platform === 'win32') {
    return removeFromWindowsPath(shims)
  } else {
    return removeFromUnixPath(shims)
  }
}

// ========== macOS/Linux 实现 ==========

function getShellRcPath(): string {
  const home = homedir()
  const shell = process.env.SHELL || ''

  if (shell.includes('zsh')) {
    return join(home, '.zshrc')
  } else if (shell.includes('bash')) {
    const bashProfile = join(home, '.bash_profile')
    const bashrc = join(home, '.bashrc')
    // macOS 优先使用 .bash_profile
    if (process.platform === 'darwin' && existsSync(bashProfile)) {
      return bashProfile
    }
    return bashrc
  } else {
    // 默认 zsh（macOS 默认）
    return join(home, '.zshrc')
  }
}

function checkUnixPath(shims: string): boolean {
  const rcPath = getShellRcPath()
  if (!existsSync(rcPath)) return false

  const content = readFileSync(rcPath, 'utf8')
  return content.includes(shims)
}

async function addToUnixPath(shims: string): Promise<string> {
  const rcPath = getShellRcPath()

  // 检查是否已存在
  if (checkUnixPath(shims)) {
    return `PATH 已配置在 ${rcPath}`
  }

  // 添加 PATH 配置
  const pathLine = `\n# EnvHub shims\nexport PATH="${shims}:$PATH"\n`

  if (existsSync(rcPath)) {
    appendFileSync(rcPath, pathLine, 'utf8')
  } else {
    writeFileSync(rcPath, pathLine, 'utf8')
  }

  return `已添加到 ${rcPath}，请重启终端或执行: source ${rcPath}`
}

async function removeFromUnixPath(shims: string): Promise<string> {
  const rcPath = getShellRcPath()

  if (!existsSync(rcPath)) {
    return 'Shell 配置文件不存在'
  }

  const content = readFileSync(rcPath, 'utf8')

  // 移除包含 shims 的行和相关注释
  const lines = content.split('\n')
  const newLines: string[] = []
  let skipNext = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 跳过 EnvHub 注释
    if (line.trim() === '# EnvHub shims') {
      skipNext = true
      continue
    }

    // 跳过包含 shims 的 PATH 行
    if (skipNext && line.includes(shims)) {
      skipNext = false
      continue
    }

    // 直接包含 shims 的行
    if (line.includes(shims) && line.includes('PATH')) {
      continue
    }

    newLines.push(line)
    skipNext = false
  }

  writeFileSync(rcPath, newLines.join('\n'), 'utf8')
  return `已从 ${rcPath} 移除，请重启终端`
}

// ========== Windows 实现 ==========

function checkWindowsPath(shims: string): boolean {
  const userPath = process.env.PATH || ''
  return userPath.split(';').some((p) => p.toLowerCase() === shims.toLowerCase())
}

async function addToWindowsPath(shims: string): Promise<string> {
  if (checkWindowsPath(shims)) {
    return 'PATH 已配置'
  }

  return new Promise((resolve, reject) => {
    // 使用 PowerShell 添加用户环境变量
    const script = `
      $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $newPath = "${shims};$currentPath"
      [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    `

    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])

    let error = ''
    ps.stderr.on('data', (data) => {
      error += data.toString()
    })

    ps.on('close', (code) => {
      if (code === 0) {
        resolve('已添加到用户 PATH，请重启终端或重新登录')
      } else {
        reject(new Error(`PowerShell 执行失败: ${error}`))
      }
    })

    ps.on('error', (err) => {
      reject(new Error(`无法启动 PowerShell: ${err.message}`))
    })
  })
}

async function removeFromWindowsPath(shims: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = `
      $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      $pathArray = $currentPath -split ';' | Where-Object { $_ -ne '${shims.replace(/\\/g, '\\\\')}' }
      $newPath = $pathArray -join ';'
      [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    `

    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])

    let error = ''
    ps.stderr.on('data', (data) => {
      error += data.toString()
    })

    ps.on('close', (code) => {
      if (code === 0) {
        resolve('已从用户 PATH 移除，请重启终端或重新登录')
      } else {
        reject(new Error(`PowerShell 执行失败: ${error}`))
      }
    })

    ps.on('error', (err) => {
      reject(new Error(`无法启动 PowerShell: ${err.message}`))
    })
  })
}
