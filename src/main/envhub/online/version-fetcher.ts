import { get as httpsGet } from 'https'
import { DetectedPlatform } from '../platform'

export interface OnlineVersion {
  version: string
  url: string
  sha256?: string
  date?: string
}

/**
 * 获取 Python 在线版本列表
 * 返回官方安装器下载链接，用户需要手动点击安装
 */
export async function fetchPythonVersions(platform: DetectedPlatform): Promise<OnlineVersion[]> {
  // Python 常用版本列表
  const commonVersions = [
    '3.13.1',
    '3.13.0',
    '3.12.8',
    '3.12.7',
    '3.12.6',
    '3.12.5',
    '3.12.4',
    '3.12.3',
    '3.12.2',
    '3.12.1',
    '3.12.0',
    '3.11.11',
    '3.11.10',
    '3.11.9',
    '3.11.8',
    '3.11.7',
    '3.11.6',
    '3.11.5',
    '3.11.4',
    '3.11.3',
    '3.11.2',
    '3.11.1',
    '3.11.0',
    '3.10.16',
    '3.10.15',
    '3.10.14',
    '3.10.13',
    '3.10.12',
    '3.10.11',
    '3.10.10',
    '3.10.9',
    '3.10.8',
    '3.10.7',
    '3.10.6',
    '3.10.5'
  ]

  const versions: OnlineVersion[] = []

  for (const version of commonVersions) {
    const url = buildPythonInstallerUrl(version, platform)
    versions.push({
      version,
      url,
      date: new Date().toISOString()
    })
  }

  return versions
}

/**
 * 构建 Python 官方安装器下载链接
 */
function buildPythonInstallerUrl(version: string, platform: DetectedPlatform): string {
  const baseUrl = 'https://www.python.org/ftp/python'

  if (platform.os === 'mac') {
    // macOS 通用安装包（支持 Intel 和 Apple Silicon）
    return `${baseUrl}/${version}/python-${version}-macos11.pkg`
  } else {
    // Windows 64位安装程序
    return `${baseUrl}/${version}/python-${version}-amd64.exe`
  }
}

/**
 * 获取 Node.js 在线版本列表
 */
export async function fetchNodeVersions(platform: DetectedPlatform): Promise<OnlineVersion[]> {
  try {
    // 使用淘宝镜像 API（更快）
    const indexUrl = 'https://npmmirror.com/mirrors/node/index.json'
    const index = await fetchJSON(indexUrl)

    // 确保返回的是数组
    if (!Array.isArray(index) || index.length === 0) {
      console.warn('No Node.js versions found or invalid response')
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

    return versions
  } catch (error) {
    console.error('Failed to fetch Node.js versions:', error)
    return []
  }
}

/**
 * 获取 PostgreSQL 在线版本列表
 * 返回 EDB 官方安装器下载链接
 */
export async function fetchPostgresVersions(platform: DetectedPlatform): Promise<OnlineVersion[]> {
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
 * 通用的 GitHub Releases 获取
 */
async function fetchGitHubReleases(owner: string, repo: string): Promise<any[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`

  return new Promise((resolve, reject) => {
    httpsGet(
      url,
      {
        headers: {
          'User-Agent': 'EnvHub/1.0',
          Accept: 'application/vnd.github.v3+json'
        },
        timeout: 10000
      },
      (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            return httpsGet(redirectUrl, { headers: { 'User-Agent': 'EnvHub/1.0' } }, resolve).on(
              'error',
              reject
            )
          }
        }

        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(Array.isArray(parsed) ? parsed : [])
          } catch (error) {
            console.error('Failed to parse GitHub response:', data.substring(0, 200))
            resolve([]) // 返回空数组而不是失败
          }
        })
      }
    ).on('error', (err) => {
      console.error('GitHub API error:', err)
      resolve([]) // 返回空数组而不是失败
    })
  })
}

/**
 * 通用的 JSON 获取
 */
async function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    httpsGet(
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
            return fetchJSON(redirectUrl).then(resolve).catch(reject)
          }
        }

        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            console.error('Failed to parse JSON response:', data.substring(0, 200))
            resolve([]) // 返回空数组
          }
        })
      }
    ).on('error', (err) => {
      console.error('Fetch JSON error:', err)
      resolve([]) // 返回空数组
    })
  })
}
