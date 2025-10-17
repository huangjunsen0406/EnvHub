import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../../core/platform'
import { mysqlDataDir, toolchainRoot } from '../../core/paths'
import { extractArchive, removeQuarantineAttr } from '../../core/extract'
import { writeShims } from '../../env/shims'
import { spawn } from 'child_process'
import { logInfo } from '../../core/log'

export interface MysqlInstallOptions {
  version: string
  platform: DetectedPlatform
  archivePath: string
}

export async function installMysql(
  opts: MysqlInstallOptions
): Promise<{ binDir: string; dataDir?: string }> {
  const baseDir = toolchainRoot('mysql', opts.version)
  mkdirSync(baseDir, { recursive: true })

  // 解压时去掉顶层目录 (mysql-9.1.0-macos14-arm64)
  // 直接解压到 ~/.envhub/toolchains/mysql/9.1.0/
  await extractArchive(opts.archivePath, baseDir, { strip: 1 })
  await removeQuarantineAttr(baseDir)

  const binDir = join(baseDir, 'bin')
  logInfo(`MySQL bin directory: ${binDir}`)

  // MySQL 二进制文件路径
  const mysql = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')
  const mysqld =
    process.platform === 'win32' ? join(binDir, 'mysqld.exe') : join(binDir, 'mysqld')
  const mysqladmin =
    process.platform === 'win32' ? join(binDir, 'mysqladmin.exe') : join(binDir, 'mysqladmin')
  const mysqldump =
    process.platform === 'win32' ? join(binDir, 'mysqldump.exe') : join(binDir, 'mysqldump')

  writeShims(opts.platform, [
    { name: 'mysql', target: mysql },
    { name: 'mysqld', target: mysqld },
    { name: 'mysqladmin', target: mysqladmin },
    { name: 'mysqldump', target: mysqldump }
  ])

  // 自动初始化默认集群 "main"
  const dataDir = await initMysqlDataDir(binDir, {
    version: opts.version,
    platform: opts.platform,
    cluster: 'main',
    port: 3306
  })

  return { binDir, dataDir }
}

export interface MysqlInitOptions {
  version: string
  platform: DetectedPlatform
  cluster: string
  port?: number
}

export async function initMysqlDataDir(
  mysqlBinDir: string,
  opts: MysqlInitOptions
): Promise<string> {
  const dataDir = join(mysqlDataDir(opts.version, opts.cluster), 'data')
  const baseDir = mysqlDataDir(opts.version, opts.cluster)
  mkdirSync(dataDir, { recursive: true })

  // 检查是否已经初始化过
  const mysqlDir = join(dataDir, 'mysql')
  if (existsSync(mysqlDir)) {
    logInfo(`MySQL data directory already initialized at ${dataDir}`)
    return dataDir
  }

  const mysqld =
    process.platform === 'win32' ? join(mysqlBinDir, 'mysqld.exe') : join(mysqlBinDir, 'mysqld')

  // 生成配置文件
  const confPath = join(baseDir, 'my.cnf')
  const socketPath = `/tmp/mysql_${opts.cluster}_${opts.port || 3306}.sock`
  const pidFile = join(dataDir, 'mysql.pid')
  const errorLog = join(baseDir, 'error.log')

  const config = `[mysqld]
datadir=${dataDir}
socket=${socketPath}
port=${opts.port || 3306}
bind-address=127.0.0.1
pid-file=${pidFile}
log-error=${errorLog}

[client]
socket=${socketPath}
port=${opts.port || 3306}
`
  writeFileSync(confPath, config, 'utf-8')
  logInfo(`MySQL configuration written to ${confPath}`)

  // 初始化数据目录（使用 --initialize-insecure 创建无密码 root）
  const args = [
    `--defaults-file=${confPath}`,
    '--initialize-insecure',
    `--datadir=${dataDir}`
  ]
  await run(mysqld, args)
  logInfo(`MySQL data directory initialized at ${dataDir}`)

  return dataDir
}

export async function mysqlStart(
  mysqlBinDir: string,
  confPath: string,
  dataDir: string
): Promise<void> {
  const mysqld =
    process.platform === 'win32' ? join(mysqlBinDir, 'mysqld.exe') : join(mysqlBinDir, 'mysqld')

  const args = [`--defaults-file=${confPath}`, `--datadir=${dataDir}`]

  return new Promise((resolve, reject) => {
    const child = spawn(mysqld, args, {
      detached: true,
      stdio: 'ignore'
    })

    child.on('error', reject)
    child.unref()

    // 等待 MySQL 启动
    setTimeout(() => {
      logInfo(`MySQL started with PID ${child.pid}`)
      resolve()
    }, 2000)
  })
}

export async function mysqlStop(mysqlBinDir: string, socketPath: string): Promise<void> {
  const mysqladmin =
    process.platform === 'win32' ? join(mysqlBinDir, 'mysqladmin.exe') : join(mysqlBinDir, 'mysqladmin')

  const args = ['-u', 'root', `--socket=${socketPath}`, 'shutdown']
  await run(mysqladmin, args)
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}
