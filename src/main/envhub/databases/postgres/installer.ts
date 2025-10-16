import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../../core/platform'
import { pgDataDir, toolchainRoot } from '../../core/paths'
import { extractArchive, removeQuarantineAttr } from '../../core/extract'
import { writeShims } from '../../env/shims'
import { spawn } from 'child_process'
import { logInfo } from '../../core/log'

export interface PgInstallOptions {
  version: string // e.g., 16.4
  platform: DetectedPlatform
  archivePath: string
}

export async function installPostgres(
  opts: PgInstallOptions
): Promise<{ binDir: string; dataDir?: string }> {
  const baseDir = toolchainRoot('pg', opts.version, opts.platform)
  mkdirSync(baseDir, { recursive: true })
  await extractArchive(opts.archivePath, baseDir)
  await removeQuarantineAttr(baseDir)

  // EDB binaries 解压后在 pgsql/ 子目录中
  const pgRoot = join(baseDir, 'pgsql')

  // Binary locations
  const binDir = join(pgRoot, 'bin')
  const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')
  const pgctl = process.platform === 'win32' ? join(binDir, 'pg_ctl.exe') : join(binDir, 'pg_ctl')
  const postgres =
    process.platform === 'win32' ? join(binDir, 'postgres.exe') : join(binDir, 'postgres')

  writeShims(opts.platform, [
    { name: 'psql', target: psql },
    { name: 'pg_ctl', target: pgctl },
    { name: 'postgres', target: postgres }
  ])

  // Auto-initialize database with default cluster "main"
  const dataDir = await initDb(binDir, {
    version: opts.version,
    platform: opts.platform,
    cluster: 'main',
    port: 5432,
    auth: 'trust'
  })

  return { binDir, dataDir }
}

export interface PgInitOptions {
  version: string
  platform: DetectedPlatform
  cluster: string
  port?: number
  auth?: 'scram' | 'md5' | 'trust'
}

export async function initDb(pgBinDir: string, opts: PgInitOptions): Promise<string> {
  const dataDir = pgDataDir(opts.version, opts.cluster)
  mkdirSync(dataDir, { recursive: true })

  // 检查是否已经初始化过（存在 PG_VERSION 文件表示已初始化）
  const { existsSync } = await import('fs')
  const pgVersionFile = join(dataDir, 'PG_VERSION')
  if (existsSync(pgVersionFile)) {
    logInfo(`Database cluster already initialized at ${dataDir}`)
    return dataDir
  }

  const initdb =
    process.platform === 'win32' ? join(pgBinDir, 'initdb.exe') : join(pgBinDir, 'initdb')
  const args = ['-D', dataDir]
  if (opts.auth === 'scram') args.push('--auth=scram-sha-256')
  else if (opts.auth === 'md5') args.push('--auth=md5')
  else if (opts.auth === 'trust') args.push('--auth=trust')
  await run(initdb, args)

  // Basic config hardening
  const confPath = join(dataDir, 'postgresql.conf')
  const hbaPath = join(dataDir, 'pg_hba.conf')
  try {
    const conf = `listen_addresses = 'localhost'\nport = ${opts.port || 5432}\n`
    writeFileSync(confPath, conf, { flag: 'a' })
  } catch (error: unknown) {
    logInfo(
      `Failed to write postgresql.conf: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    const authMethod = opts.auth || 'trust'
    const hba = `# TYPE  DATABASE        USER            ADDRESS                 METHOD\nlocal   all             all                                     ${authMethod}\n`
    writeFileSync(hbaPath, hba, { flag: 'a' })
  } catch (error: unknown) {
    logInfo(
      `Failed to write pg_hba.conf: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return dataDir
}

export async function pgStart(pgBinDir: string, dataDir: string, logFile?: string): Promise<void> {
  const pgctl =
    process.platform === 'win32' ? join(pgBinDir, 'pg_ctl.exe') : join(pgBinDir, 'pg_ctl')
  const args = ['start', '-D', dataDir]
  if (logFile) args.push('-l', logFile)
  await run(pgctl, args)
}

export async function pgStop(pgBinDir: string, dataDir: string): Promise<void> {
  const pgctl =
    process.platform === 'win32' ? join(pgBinDir, 'pg_ctl.exe') : join(pgBinDir, 'pg_ctl')
  await run(pgctl, ['stop', '-D', dataDir])
}

export async function createUser(
  pgBinDir: string,
  dbName: string,
  username: string,
  password: string
): Promise<void> {
  const psql = process.platform === 'win32' ? join(pgBinDir, 'psql.exe') : join(pgBinDir, 'psql')
  const sql = `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${username}') THEN\n    CREATE ROLE ${username} LOGIN PASSWORD '${password}';\n  END IF;\nEND$$;`
  await run(psql, ['-d', dbName, '-c', sql])
}

export async function createDatabase(
  pgBinDir: string,
  dbName: string,
  owner?: string
): Promise<void> {
  const psql = process.platform === 'win32' ? join(pgBinDir, 'psql.exe') : join(pgBinDir, 'psql')
  // 先检查数据库是否已存在，避免报错
  const checkSql = `SELECT 1 FROM pg_database WHERE datname='${dbName}'`
  try {
    const result = await runWithOutput(psql, ['-d', 'postgres', '-tAc', checkSql])
    if (result.trim()) {
      // 数据库已存在
      logInfo(`Database ${dbName} already exists`)
      return
    }
  } catch (error: unknown) {
    logInfo(
      `Failed to check database existence: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // 创建数据库
  const ownerClause = owner ? ` OWNER ${owner}` : ''
  const sql = `CREATE DATABASE ${dbName}${ownerClause};`
  await run(psql, ['-d', 'postgres', '-c', sql])
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

function runWithOutput(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'] })
    let stdout = ''
    p.stdout?.on('data', (data) => {
      stdout += data.toString()
    })
    p.on('error', reject)
    p.on('exit', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited ${code}`))
    )
  })
}
