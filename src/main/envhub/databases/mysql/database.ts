import { spawn } from 'child_process'
import { createReadStream } from 'fs'
import { join } from 'path'
import { logInfo } from '../../core/log'

export interface DatabaseInfo {
  dbName: string
  charset: string
  collation: string
  size?: string
}

/**
 * 执行 SQL 命令
 */
async function execSql(mysqlBin: string, socketPath: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-u', 'root', `--socket=${socketPath}`, '-e', sql]
    const child = spawn(mysqlBin, args, { stdio: 'inherit' })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`MySQL command failed with code ${code}`))
      }
    })
  })
}

/**
 * 执行 SQL 并返回输出
 */
async function execSqlWithOutput(
  mysqlBin: string,
  socketPath: string,
  sql: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-u', 'root', `--socket=${socketPath}`, '-e', sql]
    const child = spawn(mysqlBin, args, { stdio: ['inherit', 'pipe', 'inherit'] })

    let output = ''
    child.stdout?.on('data', (data) => {
      output += data.toString()
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(`MySQL command failed with code ${code}`))
      }
    })
  })
}

/**
 * 创建数据库
 */
export async function createMysqlDatabase(
  binDir: string,
  socketPath: string,
  dbName: string,
  charset: string = 'utf8mb4',
  collation?: string
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const collate = collation || (charset === 'utf8mb4' ? 'utf8mb4_general_ci' : 'utf8_general_ci')
  const sql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET ${charset} COLLATE ${collate};`

  logInfo(`Creating database: ${dbName} with charset ${charset}`)
  await execSql(mysqlBin, socketPath, sql)
}

/**
 * 删除数据库
 */
export async function dropMysqlDatabase(
  binDir: string,
  socketPath: string,
  dbName: string
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  // 防护：禁止删除系统库
  const systemDbs = ['mysql', 'sys', 'performance_schema', 'information_schema']
  if (systemDbs.includes(dbName)) {
    throw new Error(`Cannot drop system database: ${dbName}`)
  }

  const sql = `DROP DATABASE IF EXISTS \`${dbName}\`;`
  logInfo(`Dropping database: ${dbName}`)
  await execSql(mysqlBin, socketPath, sql)
}

/**
 * 列出所有数据库
 */
export async function listMysqlDatabases(
  binDir: string,
  socketPath: string
): Promise<DatabaseInfo[]> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `SELECT
    SCHEMA_NAME as dbName,
    DEFAULT_CHARACTER_SET_NAME as charset,
    DEFAULT_COLLATION_NAME as collation
  FROM information_schema.SCHEMATA
  WHERE SCHEMA_NAME NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema');`

  const output = await execSqlWithOutput(mysqlBin, socketPath, sql)
  return parseDatabases(output)
}

/**
 * 获取数据库大小
 */
export async function getDatabaseSize(
  binDir: string,
  socketPath: string,
  dbName: string
): Promise<string> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `SELECT
    ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
  FROM information_schema.TABLES
  WHERE table_schema = '${dbName}';`

  const output = await execSqlWithOutput(mysqlBin, socketPath, sql)
  const match = output.match(/(\d+\.\d+)/)
  return match ? `${match[1]} MB` : '0 MB'
}

/**
 * 解析数据库列表输出
 */
function parseDatabases(output: string): DatabaseInfo[] {
  const lines = output.split('\n').filter((line) => line.trim() && !line.startsWith('dbName'))

  return lines.map((line) => {
    const parts = line.split('\t')
    return {
      dbName: parts[0] || '',
      charset: parts[1] || 'utf8mb4',
      collation: parts[2] || 'utf8mb4_general_ci'
    }
  })
}

/**
 * 备份数据库
 */
export async function backupDatabase(
  binDir: string,
  socketPath: string,
  dbName: string,
  outputPath: string,
  onLog?: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const mysqldump =
      process.platform === 'win32' ? join(binDir, 'mysqldump.exe') : join(binDir, 'mysqldump')

    const args = [
      '-u',
      'root',
      `--socket=${socketPath}`,
      '--single-transaction',
      '--quick',
      '--lock-tables=false',
      dbName,
      `--result-file=${outputPath}`
    ]

    onLog?.(`Starting backup of database ${dbName}...\n`)
    const child = spawn(mysqldump, args, { stdio: ['inherit', 'pipe', 'pipe'] })

    child.stdout?.on('data', (data) => {
      onLog?.(data.toString())
    })

    child.stderr?.on('data', (data) => {
      onLog?.(data.toString())
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        onLog?.(`Backup completed successfully\n`)
        resolve()
      } else {
        reject(new Error(`mysqldump failed with code ${code}`))
      }
    })
  })
}

/**
 * 恢复数据库
 */
export async function restoreDatabase(
  binDir: string,
  socketPath: string,
  dbName: string,
  inputPath: string,
  onLog?: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const mysqlBin =
      process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

    const args = ['-u', 'root', `--socket=${socketPath}`, dbName]

    onLog?.(`Starting restore to database ${dbName}...\n`)

    const child = spawn(mysqlBin, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    // 读取备份文件并传入 stdin
    const readStream = createReadStream(inputPath)
    readStream.pipe(child.stdin)

    child.stdout?.on('data', (data: Buffer) => {
      onLog?.(data.toString())
    })

    child.stderr?.on('data', (data: Buffer) => {
      onLog?.(data.toString())
    })

    child.on('error', reject)
    child.on('exit', (code: number) => {
      if (code === 0) {
        onLog?.(`Restore completed successfully\n`)
        resolve()
      } else {
        reject(new Error(`mysql restore failed with code ${code}`))
      }
    })
  })
}
