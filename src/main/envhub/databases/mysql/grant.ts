import { spawn } from 'child_process'
import { join } from 'path'
import { logInfo } from '../../core/log'

export interface GrantInfo {
  database: string
  privileges: string[]
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
 * 授予权限
 */
export async function grantPrivileges(
  binDir: string,
  socketPath: string,
  username: string,
  host: string,
  database: string,
  privileges: string[]
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const privs = privileges.includes('ALL') ? 'ALL PRIVILEGES' : privileges.join(', ')
  const sql = `GRANT ${privs} ON \`${database}\`.* TO '${username}'@'${host}';`

  logInfo(`Granting ${privs} on ${database} to ${username}@${host}`)
  await execSql(mysqlBin, socketPath, sql)
  await execSql(mysqlBin, socketPath, 'FLUSH PRIVILEGES;')
}

/**
 * 撤销权限
 */
export async function revokePrivileges(
  binDir: string,
  socketPath: string,
  username: string,
  host: string,
  database: string,
  privileges: string[]
): Promise<void> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const privs = privileges.includes('ALL') ? 'ALL PRIVILEGES' : privileges.join(', ')
  const sql = `REVOKE ${privs} ON \`${database}\`.* FROM '${username}'@'${host}';`

  logInfo(`Revoking ${privs} on ${database} from ${username}@${host}`)
  await execSql(mysqlBin, socketPath, sql)
  await execSql(mysqlBin, socketPath, 'FLUSH PRIVILEGES;')
}

/**
 * 查询用户权限
 */
export async function showGrants(
  binDir: string,
  socketPath: string,
  username: string,
  host: string
): Promise<GrantInfo[]> {
  const mysqlBin = process.platform === 'win32' ? join(binDir, 'mysql.exe') : join(binDir, 'mysql')

  const sql = `SHOW GRANTS FOR '${username}'@'${host}';`
  const output = await execSqlWithOutput(mysqlBin, socketPath, sql)
  return parseGrants(output)
}

/**
 * 解析 GRANT 语句
 */
function parseGrants(output: string): GrantInfo[] {
  const lines = output.split('\n').filter((line) => line.trim() && line.includes('GRANT'))

  const grants: GrantInfo[] = []

  for (const line of lines) {
    // 匹配格式: GRANT <privs> ON `database`.* TO 'user'@'host'
    const match = line.match(/GRANT\s+(.+?)\s+ON\s+`?([^`*]+)`?\./)

    if (match) {
      const privsStr = match[1]
      const database = match[2]

      // 跳过全局权限和系统库
      if (database === '*' || database === 'mysql' || database === 'sys') {
        continue
      }

      // 解析权限列表
      let privileges: string[]
      if (privsStr.includes('ALL PRIVILEGES')) {
        privileges = ['ALL']
      } else {
        privileges = privsStr.split(',').map((p) => p.trim())
      }

      grants.push({
        database,
        privileges
      })
    }
  }

  return grants
}

/**
 * 获取用户有权限的数据库列表
 */
export async function getUserDatabases(
  binDir: string,
  socketPath: string,
  username: string,
  host: string
): Promise<string[]> {
  const grants = await showGrants(binDir, socketPath, username, host)
  return grants.map((g) => g.database)
}
