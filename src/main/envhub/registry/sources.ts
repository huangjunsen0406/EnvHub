import { get as httpsGet } from 'https'
import { DetectedPlatform } from '../core/platform'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { envhubRoot } from '../core/paths'
import { logInfo } from '../core/log'

export interface OnlineVersion {
  version: string
  url: string
  sha256?: string
  date?: string
}

interface CacheEntry {
  timestamp: number
  data: OnlineVersion[]
}

interface VersionCache {
  python?: CacheEntry
  node?: CacheEntry
  pg?: CacheEntry
  java?: CacheEntry
  redis?: CacheEntry
  mysql?: CacheEntry
}

// 缓存有效期：24 小时（毫秒）
const CACHE_TTL = 24 * 60 * 60 * 1000

/**
 * 获取缓存文件路径
 */
function getCachePath(): string {
  const cacheDir = join(envhubRoot(), 'cache')
  mkdirSync(cacheDir, { recursive: true })
  return join(cacheDir, 'versions-cache.json')
}

/**
 * 读取缓存
 */
function readCache(): VersionCache {
  try {
    const cachePath = getCachePath()
    if (!existsSync(cachePath)) return {}
    const content = readFileSync(cachePath, 'utf-8')
    return JSON.parse(content) as VersionCache
  } catch (error: unknown) {
    logInfo(`Failed to read cache: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

/**
 * 写入缓存
 */
function writeCache(cache: VersionCache): void {
  try {
    const cachePath = getCachePath()
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (error: unknown) {
    logInfo(`Failed to write cache: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取指定工具的缓存（如果有效）
 */
function getCachedVersions(
  tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql'
): OnlineVersion[] | null {
  const cache = readCache()
  const entry = cache[tool]

  if (!entry) return null

  const now = Date.now()
  const age = now - entry.timestamp

  if (age > CACHE_TTL) {
    logInfo(`Cache expired for ${tool} (age: ${Math.round(age / 1000 / 60)} minutes)`)
    return null
  }

  logInfo(`Using cached versions for ${tool} (age: ${Math.round(age / 1000 / 60)} minutes)`)
  return entry.data
}

/**
 * 保存版本列表到缓存
 */
function setCachedVersions(
  tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql',
  versions: OnlineVersion[]
): void {
  const cache = readCache()
  cache[tool] = {
    timestamp: Date.now(),
    data: versions
  }
  writeCache(cache)
}

/**
 * 获取 Python 在线版本列表
 * 从 nppmirror 的 python-build-standalone 获取预编译版本
 */
export async function fetchPythonVersions(
  platform: DetectedPlatform,
  forceRefresh = false
): Promise<OnlineVersion[]> {
  // 检查缓存（除非强制刷新）
  if (!forceRefresh) {
    const cached = getCachedVersions('python')
    if (cached) return cached
  }

  try {
    // 获取所有发布批次
    const releasesUrl = 'https://registry.npmmirror.com/-/binary/python-build-standalone/'
    const releases = await fetchJSON(releasesUrl)

    if (!Array.isArray(releases) || releases.length === 0) {
      logInfo('No Python releases found')
      return []
    }

    const platformKey = platform.platformKey
    const versionMap = new Map<string, { url: string; date: string }>()

    // 只遍历最近 30 个批次（覆盖最近 1-2 年的版本，大幅提升速度）
    const recentReleases = releases.slice(-30).reverse()

    // 并行请求批次（每次处理 10 个），加速获取
    const BATCH_SIZE = 10
    for (let i = 0; i < recentReleases.length; i += BATCH_SIZE) {
      const batch = recentReleases.slice(i, i + BATCH_SIZE)

      const batchPromises = batch.map(async (release) => {
        if (release.type !== 'dir') return

        const releaseDate = release.name.replace('/', '')
        const filesUrl = `https://registry.npmmirror.com/-/binary/python-build-standalone/${releaseDate}/`

        try {
          const files = await fetchJSON(filesUrl)
          if (!Array.isArray(files)) return

          // 从该批次中提取所有符合平台的 Python 文件
          const matchedFiles = selectAllPythonFiles(files, platformKey)

          for (const file of matchedFiles) {
            const pythonVersion = parsePythonVersion(file.name)
            if (!pythonVersion) continue

            // 只保留每个版本的最新构建（第一次遇到的就是最新的，因为我们倒序遍历）
            if (!versionMap.has(pythonVersion)) {
              versionMap.set(pythonVersion, {
                url: file.url,
                date: release.date
              })
            }
          }
        } catch (err: unknown) {
          // 忽略单个批次的错误，继续处理其他批次
          const message = err instanceof Error ? err.message : String(err)
          logInfo(`Failed to fetch files for ${releaseDate}: ${message}`)
        }
      })

      // 等待当前批次完成
      await Promise.allSettled(batchPromises)
    }

    // 转换为数组并按版本号降序排序
    const versions: OnlineVersion[] = Array.from(versionMap.entries()).map(
      ([version, { url, date }]) => ({
        version,
        url,
        date
      })
    )

    // 按版本号降序排序（3.13.1 > 3.13.0 > 3.12.8 ...）
    versions.sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.version.split('.').map(Number)
      const [bMajor, bMinor, bPatch] = b.version.split('.').map(Number)

      if (aMajor !== bMajor) return bMajor - aMajor
      if (aMinor !== bMinor) return bMinor - aMinor
      return bPatch - aPatch
    })

    // 保存到缓存
    setCachedVersions('python', versions)

    return versions
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to fetch Python versions: ${message}`)
    return []
  }
}

/**
 * 从文件列表中选择所有适合当前平台的 Python 文件
 * 每个版本选择最优变体
 */
interface FileItem {
  type: string
  name: string
  url?: string
}

function selectAllPythonFiles(
  files: FileItem[],
  platformKey: string
): Array<{ name: string; url: string }> {
  // 定义平台映射和优先级
  const platformPatterns: Record<string, { patterns: string[]; preferredVariant: string[] }> = {
    'darwin-arm64': {
      patterns: ['aarch64-apple-darwin', 'arm64-apple-darwin'],
      preferredVariant: ['install_only', 'pgo+lto', 'pgo']
    },
    'darwin-x64': {
      patterns: ['x86_64-apple-darwin'],
      preferredVariant: ['install_only', 'pgo+lto', 'pgo']
    },
    'win-x64': {
      patterns: ['x86_64-pc-windows-msvc'],
      preferredVariant: ['shared-install_only', 'shared-pgo', 'shared']
    }
  }

  const config = platformPatterns[platformKey]
  if (!config) return []

  // 过滤出匹配平台的所有文件
  const candidates = files.filter((file) => {
    if (file.type !== 'file') return false
    if (!file.name.endsWith('.tar.zst') && !file.name.endsWith('.tar.gz')) return false

    return config.patterns.some((pattern) => file.name.includes(pattern))
  })

  // 按版本分组
  const versionGroups = new Map<string, FileItem[]>()
  for (const file of candidates) {
    const version = parsePythonVersion(file.name)
    if (!version) continue

    if (!versionGroups.has(version)) {
      versionGroups.set(version, [])
    }
    versionGroups.get(version)!.push(file)
  }

  // 为每个版本选择最优变体
  const result: Array<{ name: string; url: string }> = []
  for (const [, filesForVersion] of versionGroups) {
    // 按优先级选择变体
    let selected: FileItem | null = null
    for (const variant of config.preferredVariant) {
      const match = filesForVersion.find((f) => f.name.includes(variant))
      if (match) {
        selected = match
        break
      }
    }

    // 如果没有找到首选变体，使用第一个
    if (!selected && filesForVersion.length > 0) {
      selected = filesForVersion[0]
    }

    if (selected && selected.url) {
      result.push({ name: selected.name, url: selected.url })
    }
  }

  return result
}

/**
 * 从文件名中解析 Python 版本号
 * 例如：cpython-3.12.0-x86_64-apple-darwin-install_only-20231002T1853.tar.zst -> 3.12.0
 */
function parsePythonVersion(filename: string): string | null {
  const match = filename.match(/cpython-(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/**
 * 获取 Node.js 在线版本列表
 */
export async function fetchNodeVersions(
  platform: DetectedPlatform,
  forceRefresh = false
): Promise<OnlineVersion[]> {
  // 检查缓存（除非强制刷新）
  if (!forceRefresh) {
    const cached = getCachedVersions('node')
    if (cached) return cached
  }

  try {
    // 使用淘宝镜像 API（更快）
    const indexUrl = 'https://npmmirror.com/mirrors/node/index.json'
    const index = await fetchJSON(indexUrl)

    // 确保返回的是数组
    if (!Array.isArray(index) || index.length === 0) {
      logInfo('No Node.js versions found or invalid response')
      return []
    }

    const versions: OnlineVersion[] = []
    const platformKey = platform.platformKey

    // 构建下载 URL
    const urlPatterns = {
      'darwin-arm64': (v: string) =>
        `https://npmmirror.com/mirrors/node/v${v}/node-v${v}-darwin-arm64.tar.gz`,
      'darwin-x64': (v: string) =>
        `https://npmmirror.com/mirrors/node/v${v}/node-v${v}-darwin-x64.tar.gz`,
      'win-x64': (v: string) => `https://npmmirror.com/mirrors/node/v${v}/node-v${v}-win-x64.zip`
    }

    const urlBuilder = urlPatterns[platformKey]
    if (!urlBuilder) return []

    // 取所有版本（前100个）
    for (const item of index.slice(0, 100)) {
      const version = item.version.replace('v', '')
      versions.push({
        version,
        url: urlBuilder(version),
        date: item.date
      })
    }

    // 保存到缓存
    setCachedVersions('node', versions)

    return versions
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to fetch Node.js versions: ${message}`)
    return []
  }
}

/**
 * 获取 PostgreSQL 在线版本列表
 * 返回 EDB 官方安装器下载链接
 */
export async function fetchPostgresVersions(
  platform: DetectedPlatform,
  forceRefresh = false
): Promise<OnlineVersion[]> {
  // 检查缓存（除非强制刷新）
  if (!forceRefresh) {
    const cached = getCachedVersions('pg')
    if (cached) return cached
  }
  // PostgreSQL 常用版本列表（EDB 提供的版本）
  const commonVersions = [
    '17.2',
    '17.1',
    '17.0',
    '16.6',
    '16.5',
    '16.4',
    '16.3',
    '16.2',
    '16.1',
    '16.0',
    '15.10',
    '15.9',
    '15.8',
    '15.7',
    '15.6',
    '15.5',
    '15.4',
    '15.3',
    '15.2',
    '15.1',
    '15.0',
    '14.15',
    '14.14',
    '14.13',
    '14.12',
    '14.11',
    '14.10',
    '14.9',
    '14.8',
    '14.7',
    '14.6',
    '14.5',
    '14.4',
    '14.3',
    '14.2',
    '14.1',
    '14.0'
  ]

  const versions: OnlineVersion[] = []

  for (const version of commonVersions) {
    // 使用 EDB 下载页面链接
    const downloadUrl = buildPostgresInstallerUrl(version, platform)
    versions.push({
      version,
      url: downloadUrl,
      date: new Date().toISOString()
    })
  }

  // 保存到缓存
  setCachedVersions('pg', versions)

  return versions
}

/**
 * 构建 PostgreSQL EDB binaries 压缩包下载链接
 * 使用 EDB 提供的二进制压缩包，而不是图形安装器
 */
function buildPostgresInstallerUrl(version: string, platform: DetectedPlatform): string {
  // EDB binaries 下载 URL 格式
  // https://get.enterprisedb.com/postgresql/postgresql-{version}-{build}-{platform}-binaries.zip
  // 例如：postgresql-16.6-1-osx-binaries.zip

  let platformStr: string
  if (platform.platformKey === 'win-x64') {
    platformStr = 'windows-x64'
  } else if (platform.platformKey === 'darwin-x64') {
    platformStr = 'osx'
  } else if (platform.platformKey === 'darwin-arm64') {
    platformStr = 'osx'
  } else {
    platformStr = 'linux-x64'
  }

  // EDB binaries 使用构建号 "-1"
  return `https://get.enterprisedb.com/postgresql/postgresql-${version}-1-${platformStr}-binaries.zip`
}

/**
 * Java 发行版类型
 */
export type JavaDistribution =
  | 'temurin'
  | 'oracle'
  | 'corretto'
  | 'graalvm'
  | 'zulu'
  | 'liberica'
  | 'microsoft'

export interface JavaVersion extends OnlineVersion {
  distribution: JavaDistribution
  lts?: boolean
}

/**
 * 获取 Java 在线版本列表
 * 默认使用 Temurin（Eclipse Adoptium）发行版
 */
export async function fetchJavaVersions(
  platform: DetectedPlatform,
  distribution: JavaDistribution = 'temurin',
  forceRefresh = false
): Promise<JavaVersion[]> {
  // 检查缓存（除非强制刷新）
  if (!forceRefresh) {
    const cached = getCachedVersions('java')
    if (cached) return cached as JavaVersion[]
  }

  try {
    // Foojay API 端点
    const { osType, archType } = getFoojayPlatform(platform)
    const archiveType = platform.platformKey === 'win-x64' ? 'zip' : 'tar.gz'
    const libcType = '' // macOS/Windows 不需要

    const apiUrl =
      `https://api.foojay.io/disco/v3.0/packages/jdks?` +
      `distribution=${distribution}` +
      `&architecture=${archType}` +
      `&archive_type=${archiveType}` +
      `&operating_system=${osType}` +
      `&lib_c_type=${libcType}` +
      `&release_status=ga` +
      `&directly_downloadable=true` +
      `&latest=available`

    logInfo(`Fetching Java versions from: ${apiUrl}`)

    const response = await fetchJSON(apiUrl)

    if (!response || !Array.isArray(response.result)) {
      logInfo('No Java versions found or invalid response')
      return []
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const versionMap = new Map<string, any>()

    // 去重，只保留每个版本号的第一个（最新构建）
    for (const pkg of response.result) {
      const version = pkg.java_version
      if (!version || versionMap.has(version)) continue

      versionMap.set(version, pkg)
    }

    // 转换为 JavaVersion 数组
    const versions: JavaVersion[] = []
    for (const [version, pkg] of versionMap) {
      // 获取详细下载信息
      try {
        const infoUrl = pkg.links?.pkg_info_uri
        if (!infoUrl) continue

        const info = await fetchJSON(infoUrl)
        const downloadUrl = info.result?.[0]?.direct_download_uri

        if (downloadUrl) {
          versions.push({
            version,
            url: downloadUrl,
            distribution,
            lts: pkg.term_of_support === 'lts',
            date: pkg.release_date || new Date().toISOString()
          })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logInfo(`Failed to fetch download URL for Java ${version}: ${message}`)
      }
    }

    // 按版本号降序排序
    versions.sort((a, b) => {
      const [aMajor = 0, aMinor = 0, aPatch = 0] = a.version.split('.').map(Number)
      const [bMajor = 0, bMinor = 0, bPatch = 0] = b.version.split('.').map(Number)

      if (aMajor !== bMajor) return bMajor - aMajor
      if (aMinor !== bMinor) return bMinor - aMinor
      return bPatch - aPatch
    })

    // 只取前 50 个版本（避免太多）
    const limitedVersions = versions.slice(0, 50)

    // 保存到缓存
    setCachedVersions('java', limitedVersions)

    return limitedVersions
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to fetch Java versions: ${message}`)
    return []
  }
}

/**
 * 将 EnvHub 平台映射到 Foojay API 参数
 */
function getFoojayPlatform(platform: DetectedPlatform): {
  osType: string
  archType: string
} {
  let osType: string
  let archType: string

  // 操作系统映射
  if (platform.platformKey.startsWith('darwin')) {
    osType = 'macos'
  } else if (platform.platformKey.startsWith('win')) {
    osType = 'windows'
  } else {
    osType = 'linux'
  }

  // 架构映射
  if (platform.platformKey.includes('arm64')) {
    archType = 'aarch64'
  } else if (platform.platformKey.includes('x64')) {
    archType = 'x64'
  } else {
    archType = 'x86'
  }

  return { osType, archType }
}

/**
 * 通用的 JSON 获取
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        headers: {
          'User-Agent': 'EnvHub/1.0',
          Accept: 'application/json'
        },
        timeout: 10000
      },
      (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            fetchJSON(redirectUrl).then(resolve).catch(reject)
            return
          }
        }

        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error: unknown) {
            const sample = data.substring(0, 200)
            logInfo(`Failed to parse JSON response: ${sample}`)
            reject(error)
          }
        })
      }
    )

    request.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      logInfo(`Fetch JSON error: ${message}`)
      reject(err)
    })
  })
}

/**
 * 获取 Redis 在线版本列表
 * macOS/Linux 使用 Redis Stack，Windows 使用 tporadowski/redis
 */
export async function fetchRedisVersions(
  platform: DetectedPlatform,
  forceRefresh = false
): Promise<OnlineVersion[]> {
  // 检查缓存
  if (!forceRefresh) {
    const cached = getCachedVersions('redis')
    if (cached) return cached
  }

  try {
    const versions: OnlineVersion[] = []

    // Windows: 使用 tporadowski/redis 5.0.14.1
    if (platform.platformKey === 'win-x64') {
      versions.push({
        version: '5.0.14.1',
        url: 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip',
        date: '2022-12-17'
      })
    } else {
      // macOS/Linux: 使用 Redis Stack
      const stackVersions = [
        { version: '7.4.0', build: 'v7', date: '2024-10-03' },
        { version: '7.2.0', build: 'v19', date: '2024-10-03' }
      ]

      for (const { version, build, date } of stackVersions) {
        const url = buildRedisStackUrl(version, build, platform)
        if (url) {
          versions.push({ version, url, date })
        }
      }
    }

    // 保存到缓存
    setCachedVersions('redis', versions)

    return versions
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to fetch Redis versions: ${message}`)
    return []
  }
}

/**
 * 构建 Redis Stack 下载链接
 */
function buildRedisStackUrl(version: string, build: string, platform: DetectedPlatform): string {
  const baseUrl = 'https://packages.redis.io/redis-stack'

  let filename: string
  if (platform.platformKey === 'darwin-arm64') {
    filename = `redis-stack-server-${version}-${build}.sonoma.arm64.zip`
  } else if (platform.platformKey === 'darwin-x64') {
    filename = `redis-stack-server-${version}-${build}.ventura.x86_64.zip`
  } else if (platform.platformKey.startsWith('linux')) {
    filename = `redis-stack-server-${version}-${build}.jammy.x86_64.tar.gz`
  } else {
    return ''
  }

  return `${baseUrl}/${filename}`
}

/**
 * 获取 MySQL 在线版本列表
 * 使用 MySQL Community Server 官方镜像
 */
export async function fetchMysqlVersions(
  platform: DetectedPlatform,
  forceRefresh = false
): Promise<OnlineVersion[]> {
  // 检查缓存
  if (!forceRefresh) {
    const cached = getCachedVersions('mysql')
    if (cached) return cached
  }

  try {
    const versions: OnlineVersion[] = []

    // MySQL 支持的版本列表（按 major.minor 分组）
    const mysqlVersions = [
      { version: '9.1.0', major: '9.1', date: '2024-11-01' },
      { version: '9.0.1', major: '9.0', date: '2024-10-15' },
      { version: '9.0.0', major: '9.0', date: '2024-07-01' },
      { version: '8.4.3', major: '8.4', date: '2024-10-14' },
      { version: '8.4.0', major: '8.4', date: '2024-04-30' },
      { version: '8.0.40', major: '8.0', date: '2024-10-01' },
      { version: '8.0.39', major: '8.0', date: '2024-07-01' }
    ]

    for (const { version, major, date } of mysqlVersions) {
      const url = buildMysqlUrl(version, major, platform)
      if (url) {
        versions.push({ version, url, date })
      }
    }

    // 保存到缓存
    setCachedVersions('mysql', versions)

    return versions
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logInfo(`Failed to fetch MySQL versions: ${message}`)
    return []
  }
}

/**
 * 构建 MySQL 下载链接
 */
function buildMysqlUrl(version: string, major: string, platform: DetectedPlatform): string {
  const baseUrl = 'https://cdn.mysql.com//Downloads'

  let osArch: string
  if (platform.platformKey === 'darwin-arm64') {
    osArch = 'macos14-arm64'
  } else if (platform.platformKey === 'darwin-x64') {
    osArch = 'macos14-x86_64'
  } else if (platform.platformKey.includes('linux')) {
    osArch = 'linux-glibc2.28-x86_64'
  } else {
    // Windows 暂不支持
    return ''
  }

  return `${baseUrl}/MySQL-${major}/mysql-${version}-${osArch}.tar.gz`
}
