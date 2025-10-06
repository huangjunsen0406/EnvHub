import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export interface PgCluster {
  version: string
  cluster: string
  dataDir: string
  port: number
  running: boolean
}

/**
 * 获取所有 PostgreSQL 集群
 */
export async function listPgClusters(): Promise<PgCluster[]> {
  // TODO: 实现扫描所有集群的逻辑
  // 目前返回空数组
  return []
}

/**
 * 检查 PostgreSQL 是否在运行
 */
export async function isPgRunning(dataDir: string): Promise<boolean> {
  const pidFile = join(dataDir, 'postmaster.pid')
  if (!existsSync(pidFile)) {
    return false
  }

  // 读取 PID 文件
  try {
    const { readFileSync } = await import('fs')
    const content = readFileSync(pidFile, 'utf8')
    const lines = content.split('\n')
    const pid = parseInt(lines[0], 10)

    if (isNaN(pid)) return false

    // 检查进程是否存在
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`)
        return stdout.includes('postgres.exe')
      } catch {
        return false
      }
    } else {
      try {
        // Unix: kill -0 检查进程是否存在
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
  } catch {
    return false
  }
}

/**
 * 停止 PostgreSQL
 */
export async function pgStop(
  binDir: string,
  dataDir: string,
  mode: 'smart' | 'fast' | 'immediate' = 'fast'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pgCtl = process.platform === 'win32' ? join(binDir, 'pg_ctl.exe') : join(binDir, 'pg_ctl')

    if (!existsSync(pgCtl)) {
      return reject(new Error(`pg_ctl not found: ${pgCtl}`))
    }

    const args = ['stop', '-D', dataDir, '-m', mode]
    const child = spawn(pgCtl, args, { stdio: 'inherit' })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pg_ctl stop failed with code ${code}`))
      }
    })
  })
}

/**
 * 重启 PostgreSQL
 */
export async function pgRestart(binDir: string, dataDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pgCtl = process.platform === 'win32' ? join(binDir, 'pg_ctl.exe') : join(binDir, 'pg_ctl')

    if (!existsSync(pgCtl)) {
      return reject(new Error(`pg_ctl not found: ${pgCtl}`))
    }

    const logFile = process.platform === 'win32' ? join(dataDir, 'pg.log') : join(dataDir, 'pg.log')
    const args = ['restart', '-D', dataDir, '-l', logFile]
    const child = spawn(pgCtl, args, { stdio: 'inherit' })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pg_ctl restart failed with code ${code}`))
      }
    })
  })
}

/**
 * 获取 PostgreSQL 状态信息
 */
export async function getPgStatus(
  _binDir: string,
  dataDir: string
): Promise<{
  running: boolean
  pid?: number
  port?: number
  dataDir: string
}> {
  const running = await isPgRunning(dataDir)

  if (!running) {
    return { running: false, dataDir }
  }

  // 读取 PID 文件获取详细信息
  try {
    const { readFileSync } = await import('fs')
    const pidFile = join(dataDir, 'postmaster.pid')
    const content = readFileSync(pidFile, 'utf8')
    const lines = content.split('\n')

    const pid = parseInt(lines[0], 10)
    const portStr = lines[3]
    const port = portStr ? parseInt(portStr, 10) : undefined

    return {
      running: true,
      pid: isNaN(pid) ? undefined : pid,
      port: port !== undefined && !isNaN(port) ? port : undefined,
      dataDir
    }
  } catch {
    return { running: true, dataDir }
  }
}
