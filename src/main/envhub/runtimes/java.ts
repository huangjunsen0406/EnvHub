import { mkdirSync, readdirSync, existsSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../core/platform'
import { toolchainRoot } from '../core/paths'
import { extractArchive, removeQuarantineAttr } from '../core/extract'
import { writeShims } from '../env/shims'
import { execSync } from 'child_process'
import { logInfo } from '../core/log'

export interface JavaInstallOptions {
  version: string
  platform: DetectedPlatform
  archivePath: string // 下载的压缩包路径
}

export async function installJava(
  opts: JavaInstallOptions
): Promise<{ javaHome: string; javaExe: string; javacExe: string }> {
  const baseDir = toolchainRoot('java', opts.version)
  mkdirSync(baseDir, { recursive: true })

  // 解压到临时目录
  const tempExtractDir = join(baseDir, 'temp_extract')
  mkdirSync(tempExtractDir, { recursive: true })
  await extractArchive(opts.archivePath, tempExtractDir)

  // 查找解压后的 JDK 目录
  // 不同发行版目录结构可能不同：
  // - jdk-21.0.1+12 (通用格式)
  // - jdk-21.0.1 (简化格式)
  // - temurin-21.0.1+12 (Temurin)
  const entries = readdirSync(tempExtractDir)
  let jdkDir = entries.find((e) => e.match(/^(jdk|temurin|zulu|graalvm|liberica|corretto)/i))

  // 如果没找到预期目录，检查是否直接解压到了根目录
  if (!jdkDir) {
    // 检查是否有 bin 和 lib 目录（直接解压的 JDK）
    if (entries.includes('bin') && entries.includes('lib')) {
      jdkDir = undefined // 标记为根目录解压
    }
  }

  if (jdkDir) {
    // 移动嵌套目录的内容到 baseDir
    const extractedPath = join(tempExtractDir, jdkDir)

    // macOS 特殊处理：JDK 可能在 .jdk/Contents/Home 子目录
    let sourcePath = extractedPath
    if (process.platform === 'darwin') {
      const contentsHome = join(extractedPath, 'Contents', 'Home')
      if (existsSync(contentsHome)) {
        sourcePath = contentsHome
      } else {
        // 检查其他可能的嵌套结构（如 jdk-21.0.1.jdk/Contents/Home）
        const jdkBundle = entries.find((e) => e.endsWith('.jdk'))
        if (jdkBundle) {
          const bundleHome = join(tempExtractDir, jdkBundle, 'Contents', 'Home')
          if (existsSync(bundleHome)) {
            sourcePath = bundleHome
          }
        }
      }
    }

    // 移动文件
    const files = readdirSync(sourcePath)
    for (const file of files) {
      const src = join(sourcePath, file)
      const dest = join(baseDir, file)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      renameSync(src, dest)
    }
  } else {
    // 根目录解压，直接移动所有文件
    for (const entry of entries) {
      const src = join(tempExtractDir, entry)
      const dest = join(baseDir, entry)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      renameSync(src, dest)
    }
  }

  // 清理临时目录
  rmSync(tempExtractDir, { recursive: true, force: true })

  // macOS 移除隔离属性
  if (process.platform === 'darwin') {
    await removeQuarantineAttr(baseDir)

    // 对 JDK 可执行文件赋予执行权限
    try {
      execSync(`chmod -R +x "${join(baseDir, 'bin')}"`, { encoding: 'utf8' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Failed to set execute permission on JDK binaries: ${message}`)
    }
  }

  // 确定可执行文件路径
  const binDir = join(baseDir, 'bin')
  const javaExe = process.platform === 'win32' ? join(binDir, 'java.exe') : join(binDir, 'java')
  const javacExe = process.platform === 'win32' ? join(binDir, 'javac.exe') : join(binDir, 'javac')
  const jarExe = process.platform === 'win32' ? join(binDir, 'jar.exe') : join(binDir, 'jar')

  // 创建 shim
  writeShims(opts.platform, [
    { name: 'java', target: javaExe },
    { name: 'javac', target: javacExe },
    { name: 'jar', target: jarExe }
  ])

  return { javaHome: baseDir, javaExe, javacExe }
}
