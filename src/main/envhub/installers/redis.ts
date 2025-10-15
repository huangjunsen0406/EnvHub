import { readdirSync, existsSync, rmSync, renameSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { DetectedPlatform } from '../platform'
import { toolchainRoot, redisDataDir, redisLogDir, shimsDir } from '../paths'
import { extractArchive, removeQuarantineAttr } from '../extract'
import { writeShims } from '../shims'
import { spawn } from 'child_process'

export interface RedisInstallOptions {
  version: string
  platform: DetectedPlatform | string
  archivePath: string
  cluster?: string
  port?: number
}

export async function installRedis(opts: RedisInstallOptions): Promise<{
  binDir: string
  confPath: string
}> {
  const baseDir = toolchainRoot('redis', opts.version, opts.platform)
  mkdirSync(baseDir, { recursive: true })

  // 1. 解压预编译包
  await extractArchive(opts.archivePath, baseDir)

  // 2. 处理 Redis Stack 嵌套目录
  const entries = readdirSync(baseDir)
  const stackDir = entries.find((e) => e.startsWith('redis-stack-server'))

  if (stackDir) {
    const extractedPath = join(baseDir, stackDir)
    const files = readdirSync(extractedPath)
    for (const file of files) {
      const src = join(extractedPath, file)
      const dest = join(baseDir, file)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      renameSync(src, dest)
    }
    rmSync(extractedPath, { recursive: true, force: true })
  }

  // 3. macOS 权限处理
  const platformKey = typeof opts.platform === 'string' ? opts.platform : opts.platform.platformKey
  if (platformKey.startsWith('darwin')) {
    await removeQuarantineAttr(baseDir)
    try {
      execSync(`chmod -R +x "${join(baseDir, 'bin')}"`, { encoding: 'utf8' })
    } catch (error) {
      console.warn('Failed to set execute permission:', error)
    }
  }

  // 4. 生成配置文件
  const cluster = opts.cluster || 'main'
  const confPath = await generateRedisConf(opts.version, cluster, opts.port || 6379)

  // 5. 创建 shims
  const isWin = platformKey === 'win-x64'
  const binDir = isWin ? baseDir : join(baseDir, 'bin')

  const serverExe = isWin ? join(baseDir, 'redis-server.exe') : join(binDir, 'redis-server')
  const cliExe = isWin ? join(baseDir, 'redis-cli.exe') : join(binDir, 'redis-cli')

  // 为 redis-cli 创建智能 shim，自动读取配置文件中的端口
  writeRedisCliShim(platformKey, cliExe, confPath)

  writeShims(platformKey, [{ name: 'redis-server', target: serverExe }])

  // Auto-start Redis
  await redisStart(binDir, confPath)

  return { binDir, confPath }
}

export function writeRedisCliShim(platformKey: string, cliExe: string, confPath: string): void {
  const isWin = platformKey === 'win-x64'
  const dir = shimsDir()

  if (isWin) {
    // Windows batch script
    const script = `@echo off
set "REDIS_CONF=${confPath}"
set "REDIS_PORT=6379"
if exist "%REDIS_CONF%" (
  for /f "tokens=2" %%p in ('findstr /b /c:"port " "%REDIS_CONF%"') do set "REDIS_PORT=%%p"
)
"${cliExe}" -p %REDIS_PORT% %*
`
    writeFileSync(join(dir, 'redis-cli.cmd'), script, 'utf8')
  } else {
    // Unix shell script
    const script = `#!/usr/bin/env bash
REDIS_CONF="${confPath}"
REDIS_PORT=6379
if [ -f "$REDIS_CONF" ]; then
  PORT_LINE=$(grep "^port " "$REDIS_CONF" 2>/dev/null | head -1)
  if [ -n "$PORT_LINE" ]; then
    REDIS_PORT=$(echo "$PORT_LINE" | awk '{print $2}')
  fi
fi
exec '${cliExe.replace(/'/g, "'\\''")}' -p "$REDIS_PORT" "$@"
`
    const shimPath = join(dir, 'redis-cli')
    writeFileSync(shimPath, script, { encoding: 'utf8', mode: 0o755 })
  }
}

export async function generateRedisConf(
  version: string,
  cluster: string,
  port: number
): Promise<string> {
  const dataDir = redisDataDir(version, cluster)
  const logDir = redisLogDir(version, cluster)

  mkdirSync(dataDir, { recursive: true })
  mkdirSync(logDir, { recursive: true })

  const confPath = join(dataDir, 'redis.conf')

  const config = `# EnvHub - Redis ${version} (${cluster})
bind 127.0.0.1 ::1
protected-mode yes
port ${port}
dir ${dataDir}
logfile ${join(logDir, 'redis.log')}
loglevel notice
daemonize no

# RDB 持久化
save 900 1
save 300 10
save 60 10000
dbfilename dump.rdb

# AOF 持久化
appendonly no
appendfilename "appendonly.aof"
`

  writeFileSync(confPath, config, 'utf8')
  return confPath
}

// 启动/停止
export async function redisStart(binDir: string, confPath: string): Promise<void> {
  const serverExe =
    process.platform === 'win32' ? join(binDir, 'redis-server.exe') : join(binDir, 'redis-server')

  // Redis 是守护进程，需要在后台启动
  // 跨平台处理：Windows、macOS、Linux
  const spawnOptions: Record<string, unknown> = {
    detached: true,
    stdio: 'ignore'
  }

  // Windows 特殊处理：隐藏窗口
  if (process.platform === 'win32') {
    spawnOptions.windowsHide = true
  }

  const child = spawn(serverExe, [confPath], spawnOptions)

  // 让父进程不等待子进程
  child.unref()

  // 等待一下确保 Redis 启动成功
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

export async function redisStop(binDir: string, port: number): Promise<void> {
  const cliExe =
    process.platform === 'win32' ? join(binDir, 'redis-cli.exe') : join(binDir, 'redis-cli')

  try {
    await run(cliExe, ['-p', port.toString(), 'SHUTDOWN', 'SAVE'])
  } catch (error) {
    // Redis 可能已经停止，忽略错误
    console.log('Redis stop command failed (may already be stopped):', error)
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}
