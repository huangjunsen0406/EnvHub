import { mkdirSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../platform'
import { toolchainRoot } from '../paths'
import { ArtifactRef } from '../manifest'
import { extractArchive, removeQuarantineAttr } from '../extract'
import { writeShims } from '../shims'

export interface NodeInstallOptions {
  version: string
  platform: DetectedPlatform
  bundleDir: string
  artifact: ArtifactRef
  pnpmPathInBundle?: string // optional relative path to a pnpm standalone script/binary
}

export async function installNode(
  opts: NodeInstallOptions
): Promise<{ nodePath: string; npmPath: string; pnpmPath?: string }> {
  const baseDir = toolchainRoot('node', opts.version, opts.platform)
  mkdirSync(baseDir, { recursive: true })

  const fs = require('fs') as typeof import('fs')
  const archivePath = join(opts.bundleDir, opts.artifact.file)

  // 解压到临时目录
  const tempExtractDir = join(baseDir, 'temp_extract')
  mkdirSync(tempExtractDir, { recursive: true })
  await extractArchive(archivePath, tempExtractDir)

  // Node.js 官方压缩包解压后会有一个 node-vX.X.X-platform 目录
  // 需要找到这个目录并移动内容到 baseDir
  const entries = fs.readdirSync(tempExtractDir)
  const nodeDir = entries.find((e) => e.startsWith('node-v'))

  if (nodeDir) {
    // 移动内容
    const extractedPath = join(tempExtractDir, nodeDir)
    const files = fs.readdirSync(extractedPath)
    for (const file of files) {
      const src = join(extractedPath, file)
      const dest = join(baseDir, file)
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true })
      }
      fs.renameSync(src, dest)
    }
  }

  // 清理临时目录
  fs.rmSync(tempExtractDir, { recursive: true, force: true })

  await removeQuarantineAttr(baseDir)

  const binDir = process.platform === 'win32' ? baseDir : join(baseDir, 'bin')
  const nodeExe = process.platform === 'win32' ? join(binDir, 'node.exe') : join(binDir, 'node')
  const npmCli = process.platform === 'win32' ? join(binDir, 'npm.cmd') : join(binDir, 'npm')

  let pnpmPath: string | undefined
  if (opts.pnpmPathInBundle) {
    pnpmPath = join(opts.bundleDir, opts.pnpmPathInBundle)
  }

  writeShims(opts.platform, [
    { name: 'node', target: nodeExe },
    { name: 'npm', target: npmCli }
  ])
  if (pnpmPath) {
    writeShims(opts.platform, [{ name: 'pnpm', target: pnpmPath }])
  }

  return { nodePath: nodeExe, npmPath: npmCli, pnpmPath }
}

export interface PnpmInstallOptions {
  nodeVersion: string
  platform: DetectedPlatform
  bundleDir: string
  pnpmTgzRelative: string // e.g., npm/pnpm-9.0.0.tgz
}

export async function installPnpmFromTgz(opts: PnpmInstallOptions): Promise<string> {
  const baseDir = toolchainRoot('node', opts.nodeVersion, opts.platform)
  const binDir = process.platform === 'win32' ? baseDir : join(baseDir, 'bin')
  const nodeExe = process.platform === 'win32' ? join(binDir, 'node.exe') : join(binDir, 'node')

  // Extract pnpm tgz into a tools dir
  const toolsDir = join(baseDir, 'tools', 'pnpm')
  mkdirSync(toolsDir, { recursive: true })
  await extractArchive(join(opts.bundleDir, opts.pnpmTgzRelative), toolsDir)

  // Guess entrypoint
  let entry = join(toolsDir, 'package', 'dist', 'pnpm.cjs')
  const fs = require('fs') as typeof import('fs')
  if (!fs.existsSync(entry)) {
    const alt = join(toolsDir, 'package', 'bin', 'pnpm.cjs')
    if (fs.existsSync(alt)) entry = alt
  }

  // Create shim that invokes node entry cjs
  writeShims(opts.platform, [{ name: 'pnpm', target: nodeExe, args: [entry] }])
  return entry
}
