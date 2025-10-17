import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { mysqlDataDir } from '../../core/paths'
import { logInfo } from '../../core/log'

export interface DatabaseMetadata {
  dbName: string
  charset: string
  collation: string
  note: string
  createdAt: string
}

export interface UserMetadata {
  username: string
  host: string
  password: string
  note: string
  createdAt: string
}

export interface GrantMetadata {
  username: string
  host: string
  database: string
  privileges: string[]
  grantedAt: string
}

/**
 * 获取元数据文件路径
 */
function getMetadataPath(
  version: string,
  cluster: string,
  type: 'databases' | 'users' | 'grants'
): string {
  const dataDir = mysqlDataDir(version, cluster)
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, `${type}.json`)
}

/**
 * 读取元数据文件
 */
function readMetadata<T>(
  version: string,
  cluster: string,
  type: 'databases' | 'users' | 'grants'
): T[] {
  const metadataPath = getMetadataPath(version, cluster, type)

  if (!existsSync(metadataPath)) {
    return []
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8')
    const data = JSON.parse(content) as { [key: string]: T[] }
    return data[type] || []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to read ${type} metadata: ${message}`)
    return []
  }
}

/**
 * 写入元数据文件
 */
function writeMetadata<T>(
  version: string,
  cluster: string,
  type: 'databases' | 'users' | 'grants',
  data: T[]
): void {
  const metadataPath = getMetadataPath(version, cluster, type)

  try {
    const obj = { [type]: data }
    writeFileSync(metadataPath, JSON.stringify(obj, null, 2), 'utf-8')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to write ${type} metadata: ${message}`)
    throw error
  }
}

// ========== 数据库元数据管理 ==========

export function addDatabaseMetadata(
  version: string,
  cluster: string,
  db: Omit<DatabaseMetadata, 'createdAt'>
): void {
  const databases = readMetadata<DatabaseMetadata>(version, cluster, 'databases')

  const exists = databases.find((d) => d.dbName === db.dbName)
  if (exists) {
    logInfo(`Database ${db.dbName} already exists in metadata`)
    return
  }

  databases.push({
    ...db,
    createdAt: new Date().toISOString()
  })

  writeMetadata(version, cluster, 'databases', databases)
}

export function deleteDatabaseMetadata(version: string, cluster: string, dbName: string): void {
  const databases = readMetadata<DatabaseMetadata>(version, cluster, 'databases')
  const filtered = databases.filter((d) => d.dbName !== dbName)
  writeMetadata(version, cluster, 'databases', filtered)
}

export function getAllDatabaseMetadata(version: string, cluster: string): DatabaseMetadata[] {
  return readMetadata<DatabaseMetadata>(version, cluster, 'databases')
}

export function getDatabaseMetadata(
  version: string,
  cluster: string,
  dbName: string
): DatabaseMetadata | null {
  const databases = readMetadata<DatabaseMetadata>(version, cluster, 'databases')
  return databases.find((d) => d.dbName === dbName) || null
}

// ========== 用户元数据管理 ==========

export function addUserMetadata(
  version: string,
  cluster: string,
  user: Omit<UserMetadata, 'createdAt'>
): void {
  const users = readMetadata<UserMetadata>(version, cluster, 'users')

  const exists = users.find((u) => u.username === user.username && u.host === user.host)
  if (exists) {
    logInfo(`User ${user.username}@${user.host} already exists in metadata`)
    return
  }

  users.push({
    ...user,
    createdAt: new Date().toISOString()
  })

  writeMetadata(version, cluster, 'users', users)
}

export function deleteUserMetadata(
  version: string,
  cluster: string,
  username: string,
  host: string
): void {
  const users = readMetadata<UserMetadata>(version, cluster, 'users')
  const filtered = users.filter((u) => !(u.username === username && u.host === host))
  writeMetadata(version, cluster, 'users', filtered)
}

export function updateUserPassword(
  version: string,
  cluster: string,
  username: string,
  host: string,
  newPassword: string
): void {
  const users = readMetadata<UserMetadata>(version, cluster, 'users')
  const user = users.find((u) => u.username === username && u.host === host)

  if (user) {
    user.password = newPassword
    writeMetadata(version, cluster, 'users', users)
  } else {
    logInfo(`User ${username}@${host} not found in metadata`)
  }
}

export function getAllUserMetadata(version: string, cluster: string): UserMetadata[] {
  return readMetadata<UserMetadata>(version, cluster, 'users')
}

// ========== 权限元数据管理 ==========

export function addGrantMetadata(
  version: string,
  cluster: string,
  grant: Omit<GrantMetadata, 'grantedAt'>
): void {
  const grants = readMetadata<GrantMetadata>(version, cluster, 'grants')

  const exists = grants.find(
    (g) => g.username === grant.username && g.host === grant.host && g.database === grant.database
  )

  if (exists) {
    // 更新权限
    exists.privileges = grant.privileges
    exists.grantedAt = new Date().toISOString()
  } else {
    grants.push({
      ...grant,
      grantedAt: new Date().toISOString()
    })
  }

  writeMetadata(version, cluster, 'grants', grants)
}

export function deleteGrantMetadata(
  version: string,
  cluster: string,
  username: string,
  host: string,
  database: string
): void {
  const grants = readMetadata<GrantMetadata>(version, cluster, 'grants')
  const filtered = grants.filter(
    (g) => !(g.username === username && g.host === host && g.database === database)
  )
  writeMetadata(version, cluster, 'grants', filtered)
}

export function getUserGrantsMetadata(
  version: string,
  cluster: string,
  username: string,
  host: string
): GrantMetadata[] {
  const grants = readMetadata<GrantMetadata>(version, cluster, 'grants')
  return grants.filter((g) => g.username === username && g.host === host)
}

export function getAllGrantsMetadata(version: string, cluster: string): GrantMetadata[] {
  return readMetadata<GrantMetadata>(version, cluster, 'grants')
}
