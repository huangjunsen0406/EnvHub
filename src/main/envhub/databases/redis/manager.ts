import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export interface RedisCluster {
  version: string
  cluster: string
  port: number
  running: boolean
}

/**
 * 检查 Redis 是否在运行
 */
export async function isRedisRunning(port: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // Windows: 使用 netstat 检查端口
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
      return stdout.includes('LISTENING')
    } else {
      // Unix: 使用 lsof 检查端口
      try {
        const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN`)
        return stdout.includes('redis')
      } catch {
        return false
      }
    }
  } catch {
    return false
  }
}

/**
 * 停止 Redis
 */
export async function redisStop(binDir: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const redisCli =
      process.platform === 'win32' ? join(binDir, 'redis-cli.exe') : join(binDir, 'redis-cli')

    if (!existsSync(redisCli)) {
      return reject(new Error(`redis-cli not found: ${redisCli}`))
    }

    const args = ['-p', port.toString(), 'shutdown']
    const child = spawn(redisCli, args, { stdio: 'inherit' })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolve()
      } else {
        reject(new Error(`redis-cli shutdown failed with code ${code}`))
      }
    })
  })
}

/**
 * 获取 Redis 进程 PID
 */
async function getRedisPid(port: number): Promise<number | undefined> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
      const lines = stdout.split('\n').filter((line) => line.includes('LISTENING'))
      if (lines.length > 0) {
        const parts = lines[0].trim().split(/\s+/)
        const pid = parseInt(parts[parts.length - 1], 10)
        return isNaN(pid) ? undefined : pid
      }
      return undefined
    } else {
      const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t`)
      const pid = parseInt(stdout.trim(), 10)
      return isNaN(pid) ? undefined : pid
    }
  } catch {
    return undefined
  }
}

/**
 * 获取 Redis 状态信息
 */
export async function getRedisStatus(port: number): Promise<{
  running: boolean
  pid?: number
  port?: number
}> {
  const running = await isRedisRunning(port)

  if (!running) {
    return { running: false }
  }

  const pid = await getRedisPid(port)

  return {
    running: true,
    pid,
    port
  }
}
