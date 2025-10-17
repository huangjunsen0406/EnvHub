import { spawn } from 'child_process'
import { join } from 'path'
import { logInfo } from '../../core/log'

export interface UserInfo {
  username: string
  host: string
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
 * 创建 MySQL 用户
 */
export async function createMysqlUser(
  binDir: string,
  socketPath: string,
  username: string,
  password: string,
  host: string = 'localhost'
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `CREATE USER IF NOT EXISTS '${username}'@'${host}' IDENTIFIED BY '${password}';`
  logInfo(`Creating user: ${username}@${host}`)
  await execSql(mysqlBin, socketPath, sql)
}

/**
 * 删除 MySQL 用户
 */
export async function dropMysqlUser(
  binDir: string,
  socketPath: string,
  username: string,
  host: string
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  // 防护：禁止删除 root 用户
  if (username === 'root') {
    throw new Error('Cannot drop root user')
  }

  const sql = `DROP USER IF EXISTS '${username}'@'${host}';`
  logInfo(`Dropping user: ${username}@${host}`)
  await execSql(mysqlBin, socketPath, sql)
}

/**
 * 修改用户密码
 */
export async function changeMysqlPassword(
  binDir: string,
  socketPath: string,
  username: string,
  host: string,
  newPassword: string
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `ALTER USER '${username}'@'${host}' IDENTIFIED BY '${newPassword}';`
  logInfo(`Changing password for user: ${username}@${host}`)
  await execSql(mysqlBin, socketPath, sql)
  await execSql(mysqlBin, socketPath, 'FLUSH PRIVILEGES;')
}

/**
 * 列出所有用户
 */
export async function listMysqlUsers(binDir: string, socketPath: string): Promise<UserInfo[]> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `SELECT User, Host FROM mysql.user WHERE User NOT IN ('root', 'mysql.sys', 'mysql.session', 'mysql.infoschema') ORDER BY User, Host;`
  const output = await execSqlWithOutput(mysqlBin, socketPath, sql)
  return parseUsers(output)
}

/**
 * 解析用户列表输出
 */
function parseUsers(output: string): UserInfo[] {
  const lines = output.split('\n').filter((line) => line.trim() && !line.startsWith('User'))

  return lines.map((line) => {
    const parts = line.split('\t')
    return {
      username: parts[0] || '',
      host: parts[1] || 'localhost'
    }
  })
}
