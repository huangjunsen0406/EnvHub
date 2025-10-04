import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import { pipeline } from 'stream/promises'
import { get as httpsGet } from 'https'
import { get as httpGet } from 'http'
import { join, dirname } from 'path'
import { envhubRoot } from '../paths'

export interface DownloadProgress {
  downloaded: number
  total: number
  percent: number
  speed: number // bytes/sec
  eta: number // seconds
}

export interface DownloadOptions {
  url: string
  savePath: string
  onProgress?: (progress: DownloadProgress) => void
  resume?: boolean // 支持断点续传
  timeout?: number // 超时时间（毫秒）
}

export function cacheDir(): string {
  return join(envhubRoot(), 'cache', 'downloads')
}

export function tempDir(): string {
  return join(envhubRoot(), 'cache', 'temp')
}

/**
 * 下载文件
 */
export async function downloadFile(options: DownloadOptions): Promise<string> {
  const { url, savePath, onProgress, resume = false, timeout = 120000 } = options

  // 确保目录存在
  mkdirSync(dirname(savePath), { recursive: true })
  mkdirSync(tempDir(), { recursive: true })

  const tempPath = `${savePath}.part`
  let downloaded = 0
  let total = 0
  let startTime = Date.now()
  let lastTime = startTime
  let lastDownloaded = 0

  // 检查是否支持续传
  const existingSize = resume && existsSync(tempPath) ? statSync(tempPath).size : 0

  return new Promise((resolve, reject) => {
    const headers: any = {
      'User-Agent': 'EnvHub/1.0 (Electron)',
      Accept: '*/*'
    }
    if (existingSize > 0) {
      headers['Range'] = `bytes=${existingSize}-`
      downloaded = existingSize
    }

    const getMethod = url.startsWith('https') ? httpsGet : httpGet

    const request = getMethod(url, { headers, timeout }, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          return downloadFile({ ...options, url: redirectUrl })
            .then(resolve)
            .catch(reject)
        }
      }

      // 检查状态码
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        return reject(
          new Error(`Download failed with status ${response.statusCode}: ${response.statusMessage}`)
        )
      }

      // 获取文件总大小
      const contentLength = response.headers['content-length']
      if (contentLength) {
        total = parseInt(contentLength, 10)
        if (response.statusCode === 206) {
          // 206 Partial Content - 续传
          total += existingSize
        }
      }

      // 创建写入流
      const fileStream = createWriteStream(tempPath, {
        flags: existingSize > 0 ? 'a' : 'w' // append or write
      })

      // 进度更新
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length

        if (onProgress) {
          const now = Date.now()
          const timeDiff = (now - lastTime) / 1000 // 秒
          const downloadedDiff = downloaded - lastDownloaded

          // 每 500ms 更新一次进度
          if (timeDiff >= 0.5) {
            const speed = downloadedDiff / timeDiff
            const remaining = total - downloaded
            const eta = remaining / speed

            onProgress({
              downloaded,
              total,
              percent: total > 0 ? (downloaded / total) * 100 : 0,
              speed,
              eta
            })

            lastTime = now
            lastDownloaded = downloaded
          }
        }
      })

      // 下载完成
      pipeline(response, fileStream)
        .then(() => {
          // 重命名临时文件
          const fs = require('fs')
          fs.renameSync(tempPath, savePath)

          // 最后一次进度更新
          if (onProgress) {
            onProgress({
              downloaded: total,
              total,
              percent: 100,
              speed: 0,
              eta: 0
            })
          }

          resolve(savePath)
        })
        .catch(reject)
    })

    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('Download timeout'))
    })
  })
}

/**
 * 格式化文件大小
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

/**
 * 格式化时间（秒）
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '未知'
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  return `${Math.round(seconds / 3600)} 小时`
}

/**
 * 扫描下载目录，查找已下载的 Python 安装包
 * PostgreSQL 和 Node.js 使用压缩包，会自动安装，不需要扫描
 */
export function scanDownloadedInstallers(): {
  python: Record<string, string>
  pg: Record<string, string>
} {
  const fs = require('fs')
  const result = {
    python: {} as Record<string, string>,
    pg: {} as Record<string, string>
  }

  const downloadDir = cacheDir()
  if (!existsSync(downloadDir)) {
    return result
  }

  try {
    const files = fs.readdirSync(downloadDir)

    for (const file of files) {
      const fullPath = join(downloadDir, file)
      const stat = fs.statSync(fullPath)

      // 只处理文件，忽略目录
      if (!stat.isFile()) continue

      // Python 安装包匹配
      // Windows: python-3.12.0-amd64.exe
      // macOS: python-3.12.0-macos11.pkg
      const pythonMatch = file.match(/^python-(\d+\.\d+\.\d+)-(?:amd64\.exe|macos11\.pkg)$/)
      if (pythonMatch) {
        const version = pythonMatch[1]
        result.python[version] = fullPath
        continue
      }
    }
  } catch (error) {
    console.error('Failed to scan download directory:', error)
  }

  return result
}
