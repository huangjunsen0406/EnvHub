import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export interface MysqlCluster {
  version: string
  cluster: string
  dataDir: string
  port: number
  running: boolean
}

/**
 * 检查 MySQL 是否在运行
 */
export async function isMysqlRunning(dataDir: string): Promise<boolean> {
  const pidFile = join(dataDir, 'mysql.pid')
  if (!existsSync(pidFile)) {
    return false
  }

  try {
    const content = readFileSync(pidFile, 'utf8')
    const pid = parseInt(content.trim(), 10)

    if (isNaN(pid)) return false

    // 检查进程是否存在
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`)
        return stdout.includes('mysqld.exe')
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
 * 停止 MySQL
 */
export async function mysqlStop(binDir: string, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mysqladmin =
      process.platform === 'win32' ? join(binDir, 'mysqladmin.exe') : join(binDir, 'mysqladmin')

    if (!existsSync(mysqladmin)) {
      return reject(new Error(`mysqladmin not found: ${mysqladmin}`))
    }

    const args = ['-u', 'root', `--socket=${socketPath}`, 'shutdown']
    const child = spawn(mysqladmin, args, { stdio: 'inherit' })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`mysqladmin shutdown failed with code ${code}`))
      }
    })
  })
}

/**
 * 获取 MySQL 状态信息
 */
export async function getMysqlStatus(
  dataDir: string,
  port: number
): Promise<{
  running: boolean
  pid?: number
  port?: number
  dataDir: string
}> {
  const running = await isMysqlRunning(dataDir)

  if (!running) {
    return { running: false, dataDir }
  }

  // 读取 PID 文件获取详细信息
  try {
    const pidFile = join(dataDir, 'mysql.pid')
    const content = readFileSync(pidFile, 'utf8')
    const pid = parseInt(content.trim(), 10)

    return {
      running: true,
      pid: isNaN(pid) ? undefined : pid,
      port,
      dataDir
    }
  } catch {
    return { running: true, port, dataDir }
  }
}
