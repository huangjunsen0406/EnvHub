import { mkdirSync, readdirSync, existsSync, rmSync, renameSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../core/platform'
import { toolchainRoot } from '../core/paths'
import { extractArchive, removeQuarantineAttr } from '../core/extract'
import { writeShims } from '../env/shims'

export interface NodeInstallOptions {
  version: string
  platform: DetectedPlatform
  archivePath: string
}

export async function installNode(
  opts: NodeInstallOptions
): Promise<{ nodePath: string; npmPath: string }> {
  const baseDir = toolchainRoot('node', opts.version)
  mkdirSync(baseDir, { recursive: true })

  // 解压到临时目录
  const tempExtractDir = join(baseDir, 'temp_extract')
  mkdirSync(tempExtractDir, { recursive: true })
  await extractArchive(opts.archivePath, tempExtractDir)

  // Node.js 官方压缩包解压后会有一个 node-vX.X.X-platform 目录
  // 需要找到这个目录并移动内容到 baseDir
  const entries = readdirSync(tempExtractDir)
  const nodeDir = entries.find((e) => e.startsWith('node-v'))

  if (nodeDir) {
    // 移动内容
    const extractedPath = join(tempExtractDir, nodeDir)
    const files = readdirSync(extractedPath)
    for (const file of files) {
      const src = join(extractedPath, file)
      const dest = join(baseDir, file)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      renameSync(src, dest)
    }
  }

  // 清理临时目录
  rmSync(tempExtractDir, { recursive: true, force: true })

  await removeQuarantineAttr(baseDir)

  const binDir = process.platform === 'win32' ? baseDir : join(baseDir, 'bin')
  const nodeExe = process.platform === 'win32' ? join(binDir, 'node.exe') : join(binDir, 'node')
  const npmCli = process.platform === 'win32' ? join(binDir, 'npm.cmd') : join(binDir, 'npm')

  writeShims(opts.platform, [
    { name: 'node', target: nodeExe },
    { name: 'npm', target: npmCli }
  ])

  return { nodePath: nodeExe, npmPath: npmCli }
}
