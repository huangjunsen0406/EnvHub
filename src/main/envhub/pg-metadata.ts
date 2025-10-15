import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { pgDataDir } from './paths'

export interface DatabaseMetadata {
  dbName: string
  username: string
  password: string
  note: string
  createdAt: string
}

interface MetadataFile {
  databases: DatabaseMetadata[]
}

/**
 * 获取元数据文件路径
 */
function getMetadataPath(majorVersion: string, cluster: string): string {
  const dataDir = pgDataDir(majorVersion, cluster)
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'databases.json')
}

/**
 * 读取元数据文件
 */
function readMetadata(majorVersion: string, cluster: string): MetadataFile {
  const metadataPath = getMetadataPath(majorVersion, cluster)

  if (!existsSync(metadataPath)) {
    return { databases: [] }
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8')
    return JSON.parse(content) as MetadataFile
  } catch (error) {
    console.error('Failed to read metadata:', error)
    return { databases: [] }
  }
}

/**
 * 写入元数据文件
 */
function writeMetadata(majorVersion: string, cluster: string, data: MetadataFile): void {
  const metadataPath = getMetadataPath(majorVersion, cluster)

  try {
    writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to write metadata:', error)
    throw error
  }
}

/**
 * 添加数据库记录
 */
export function addDatabaseMetadata(
  majorVersion: string,
  cluster: string,
  db: Omit<DatabaseMetadata, 'createdAt'>
): void {
  const metadata = readMetadata(majorVersion, cluster)

  // 检查是否已存在
  const exists = metadata.databases.find((d) => d.dbName === db.dbName)
  if (exists) {
    console.warn(`Database ${db.dbName} already exists in metadata`)
    return
  }

  metadata.databases.push({
    ...db,
    createdAt: new Date().toISOString()
  })

  writeMetadata(majorVersion, cluster, metadata)
}

/**
 * 更新数据库密码
 */
export function updateDatabasePassword(
  majorVersion: string,
  cluster: string,
  username: string,
  newPassword: string
): void {
  const metadata = readMetadata(majorVersion, cluster)

  const db = metadata.databases.find((d) => d.username === username)
  if (db) {
    db.password = newPassword
    writeMetadata(majorVersion, cluster, metadata)
  } else {
    console.warn(`Database with username ${username} not found in metadata`)
  }
}

/**
 * 删除数据库记录
 */
export function deleteDatabaseMetadata(
  majorVersion: string,
  cluster: string,
  dbName: string
): void {
  const metadata = readMetadata(majorVersion, cluster)

  metadata.databases = metadata.databases.filter((d) => d.dbName !== dbName)

  writeMetadata(majorVersion, cluster, metadata)
}

/**
 * 获取所有数据库元数据
 */
export function getAllDatabaseMetadata(majorVersion: string, cluster: string): DatabaseMetadata[] {
  const metadata = readMetadata(majorVersion, cluster)
  return metadata.databases
}

/**
 * 获取单个数据库元数据
 */
export function getDatabaseMetadata(
  majorVersion: string,
  cluster: string,
  dbName: string
): DatabaseMetadata | null {
  const metadata = readMetadata(majorVersion, cluster)
  return metadata.databases.find((d) => d.dbName === dbName) || null
}
