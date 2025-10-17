import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { envhubRoot, toolchainRoot, redisDataDir } from './paths'
import { DetectedPlatform } from './platform'
import { writeShims, removeShims } from '../env/shims'
import { execSync } from 'child_process'
import { writeRedisCliShim } from '../databases/redis/installer'
import { logInfo } from './log'
export type Tool = 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql'

interface CurrentState {
  current?: Partial<Record<Tool, string>>
}

function currentStatePath(): string {
  return join(envhubRoot(), 'current.json')
}

export function getCurrent(): CurrentState {
  try {
    const p = currentStatePath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as CurrentState
  } catch (e: unknown) {
    logInfo(`Start current failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { current: {} }
}

export function setCurrent(tool: Tool, version: string): void {
  const state = getCurrent()
  state.current = state.current || {}
  if (version === '') {
    delete state.current[tool]
  } else {
    state.current[tool] = version
  }
  mkdirSync(envhubRoot(), { recursive: true })
  writeFileSync(currentStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

export function listInstalled(
  tool: Tool,
  _dp: DetectedPlatform
): { version: string; path: string }[] {
  const base = join(envhubRoot(), 'toolchains', tool)
  try {
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const items: { version: string; path: string }[] = []
    for (const v of versions) {
      const p = toolchainRoot(tool, v)
      if (existsSync(p)) items.push({ version: v, path: p })
    }
    return items
  } catch {
    return []
  }
}

export function uninstallTool(tool: Tool, version: string, _dp: DetectedPlatform): void {
  const p = toolchainRoot(tool, version)
  if (!existsSync(p)) {
    logInfo(`Tool path not found: ${p}`)
  } else {
    try {
      // 对于 macOS，使用 rm -rf 处理 .app 包和 .asar 文件
      if (process.platform === 'darwin') {
        execSync(`rm -rf "${p}"`, { encoding: 'utf8' })
      } else {
        // Windows 和 Linux 使用 Node.js 的 rmSync
        rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      }
      logInfo(`Uninstalled ${tool}@${version} from ${p}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Failed to uninstall ${tool} binaries: ${message}`)
      throw error
    }
  }

  // 对于 PostgreSQL，删除数据目录和元数据
  if (tool === 'pg') {
    try {
      const pgDataRoot = join(envhubRoot(), 'pg', version)
      if (existsSync(pgDataRoot)) {
        if (process.platform === 'darwin') {
          execSync(`rm -rf "${pgDataRoot}"`, { encoding: 'utf8' })
        } else {
          rmSync(pgDataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
        logInfo(`Deleted PostgreSQL data directory: ${pgDataRoot}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Warning: Failed to delete PostgreSQL data directory: ${message}`)
      // 不抛出错误，仅记录警告
    }
  }

  // 对于 Redis，删除数据和日志目录
  if (tool === 'redis') {
    try {
      const redisDataRoot = join(envhubRoot(), 'data', 'redis', version)
      const redisLogRoot = join(envhubRoot(), 'logs', 'redis', version)

      if (existsSync(redisDataRoot)) {
        if (process.platform === 'darwin') {
          execSync(`rm -rf "${redisDataRoot}"`, { encoding: 'utf8' })
        } else {
          rmSync(redisDataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
        logInfo(`Deleted Redis data directory: ${redisDataRoot}`)
      }

      if (existsSync(redisLogRoot)) {
        if (process.platform === 'darwin') {
          execSync(`rm -rf "${redisLogRoot}"`, { encoding: 'utf8' })
        } else {
          rmSync(redisLogRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
        logInfo(`Deleted Redis log directory: ${redisLogRoot}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Warning: Failed to delete Redis data/log directory: ${message}`)
      // 不抛出错误，仅记录警告
    }
  }

  // 对于 MySQL，删除数据和日志目录
  if (tool === 'mysql') {
    try {
      const mysqlDataRoot = join(envhubRoot(), 'mysql', version)
      const mysqlLogRoot = join(envhubRoot(), 'logs', 'mysql', version)

      if (existsSync(mysqlDataRoot)) {
        if (process.platform === 'darwin') {
          execSync(`rm -rf "${mysqlDataRoot}"`, { encoding: 'utf8' })
        } else {
          rmSync(mysqlDataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
        logInfo(`Deleted MySQL data directory: ${mysqlDataRoot}`)
      }

      if (existsSync(mysqlLogRoot)) {
        if (process.platform === 'darwin') {
          execSync(`rm -rf "${mysqlLogRoot}"`, { encoding: 'utf8' })
        } else {
          rmSync(mysqlLogRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
        logInfo(`Deleted MySQL log directory: ${mysqlLogRoot}`)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Warning: Failed to delete MySQL data/log directory: ${message}`)
      // 不抛出错误，仅记录警告
    }
  }
}

export function updateShimsForTool(tool: Tool, version: string, dp: DetectedPlatform): void {
  // If version is empty, remove shims
  if (version === '') {
    if (tool === 'python') {
      removeShims(dp, ['python', 'pip'])
    } else if (tool === 'node') {
      removeShims(dp, ['node', 'npm'])
    } else if (tool === 'pg') {
      removeShims(dp, ['psql', 'pg_ctl', 'postgres'])
    } else if (tool === 'java') {
      removeShims(dp, ['java', 'javac', 'jar'])
    } else if (tool === 'redis') {
      removeShims(dp, ['redis-server', 'redis-cli'])
    } else if (tool === 'mysql') {
      removeShims(dp, ['mysql', 'mysqld', 'mysqladmin', 'mysqldump'])
    }
    setCurrent(tool, '')
    return
  }

  // Create shims for the specified version
  const base = toolchainRoot(tool, version)
  if (tool === 'python') {
    const python =
      process.platform === 'win32' ? join(base, 'python.exe') : join(base, 'bin', 'python')
    writeShims(dp, [
      { name: 'python', target: python },
      { name: 'pip', target: python, args: ['-m', 'pip'] }
    ])
  } else if (tool === 'node') {
    const node = process.platform === 'win32' ? join(base, 'node.exe') : join(base, 'bin', 'node')
    const npm = process.platform === 'win32' ? join(base, 'npm.cmd') : join(base, 'bin', 'npm')
    writeShims(dp, [
      { name: 'node', target: node },
      { name: 'npm', target: npm }
    ])
  } else if (tool === 'pg') {
    // EDB binaries 解压后在 pgsql/ 子目录中
    const binDir = join(base, 'pgsql', 'bin')
    const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')
    const pgctl = process.platform === 'win32' ? join(binDir, 'pg_ctl.exe') : join(binDir, 'pg_ctl')
    const postgres =
      process.platform === 'win32' ? join(binDir, 'postgres.exe') : join(binDir, 'postgres')
    writeShims(dp, [
      { name: 'psql', target: psql },
      { name: 'pg_ctl', target: pgctl },
      { name: 'postgres', target: postgres }
    ])
  } else if (tool === 'java') {
    const binDir = join(base, 'bin')
    const java = process.platform === 'win32' ? join(binDir, 'java.exe') : join(binDir, 'java')
    const javac = process.platform === 'win32' ? join(binDir, 'javac.exe') : join(binDir, 'javac')
    const jar = process.platform === 'win32' ? join(binDir, 'jar.exe') : join(binDir, 'jar')
    writeShims(dp, [
      { name: 'java', target: java },
      { name: 'javac', target: javac },
      { name: 'jar', target: jar }
    ])
  } else if (tool === 'redis') {
    const isWin = process.platform === 'win32'
    const binDir = isWin ? base : join(base, 'bin')
    const serverExe = isWin ? join(base, 'redis-server.exe') : join(binDir, 'redis-server')
    const cliExe = isWin ? join(base, 'redis-cli.exe') : join(binDir, 'redis-cli')

    // 使用智能 shim 生成器为 redis-cli
    const dataDir = redisDataDir(version, 'main')
    const confPath = join(dataDir, 'redis.conf')
    writeRedisCliShim(isWin ? 'win-x64' : dp.platformKey, cliExe, confPath)

    writeShims(dp, [{ name: 'redis-server', target: serverExe }])
  } else if (tool === 'mysql') {
    const binDir = join(base, 'bin')
    const mysql = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')
    const mysqld =
      process.platform === 'win32' ? join(binDir, 'mysqld.exe') : join(binDir, 'mysqld')
    const mysqladmin =
      process.platform === 'win32' ? join(binDir, 'mysqladmin.exe') : join(binDir, 'mysqladmin')
    const mysqldump =
      process.platform === 'win32' ? join(binDir, 'mysqldump.exe') : join(binDir, 'mysqldump')
    writeShims(dp, [
      { name: 'mysql', target: mysql },
      { name: 'mysqld', target: mysqld },
      { name: 'mysqladmin', target: mysqladmin },
      { name: 'mysqldump', target: mysqldump }
    ])
  }
  setCurrent(tool, version)
}
