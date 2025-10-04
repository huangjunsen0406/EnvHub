import { mkdirSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../platform'
import { toolchainRoot } from '../paths'
import { ArtifactRef } from '../manifest'
import { extractArchive, removeQuarantineAttr } from '../extract'
import { writeShims } from '../shims'
import { spawn } from 'child_process'

export interface PythonInstallOptions {
  version: string
  platform: DetectedPlatform
  bundleDir: string
  artifact: ArtifactRef
}

export async function installPython(opts: PythonInstallOptions): Promise<string> {
  const baseDir = toolchainRoot('python', opts.version, opts.platform)
  mkdirSync(baseDir, { recursive: true })

  const fs = require('fs') as typeof import('fs')
  const archivePath = join(opts.bundleDir, opts.artifact.file)

  // 解压到临时目录
  const tempExtractDir = join(baseDir, 'temp_extract')
  mkdirSync(tempExtractDir, { recursive: true })
  await extractArchive(archivePath, tempExtractDir)

  // python-build-standalone 解压后会有一个 python 目录
  const entries = fs.readdirSync(tempExtractDir)
  const pythonDir = entries.find((e) => e === 'python' || e.startsWith('cpython-'))

  if (pythonDir) {
    // 移动内容
    const extractedPath = join(tempExtractDir, pythonDir)
    const files = fs.readdirSync(extractedPath)
    for (const file of files) {
      const src = join(extractedPath, file)
      const dest = join(baseDir, file)
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true })
      }
      fs.renameSync(src, dest)
    }
  } else {
    // 如果没有子目录，直接移动所有内容
    const files = fs.readdirSync(tempExtractDir)
    for (const file of files) {
      const src = join(tempExtractDir, file)
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

  // Guess binary locations
  const binDir = process.platform === 'win32' ? baseDir : findBinDir(baseDir)
  const pythonExe =
    process.platform === 'win32' ? join(binDir, 'python.exe') : join(binDir, 'python3')

  // 如果 python3 不存在，尝试 python
  if (!fs.existsSync(pythonExe) && process.platform !== 'win32') {
    const altPython = join(binDir, 'python')
    if (fs.existsSync(altPython)) {
      const pythonExe = altPython
    }
  }

  // Ensure pip is available
  try {
    await runPython(pythonExe, ['-m', 'ensurepip', '--upgrade'])
  } catch (error) {
    console.warn('Failed to ensure pip, it may already be installed:', error)
  }

  // Create shims for python and pip (pip via -m to avoid path guessing)
  writeShims(opts.platform, [
    { name: 'python', target: pythonExe },
    { name: 'pip', target: pythonExe, args: ['-m', 'pip'] }
  ])

  return pythonExe
}

function findBinDir(baseDir: string): string {
  // Many standalone builds unpack to baseDir or baseDir/<something>
  // Fallback to baseDir if "bin" not found.
  const candidate = join(baseDir, 'bin')
  try {
    // dynamic import to avoid fs/promises
    const fs = require('fs') as typeof import('fs')
    if (fs.existsSync(candidate)) return candidate
  } catch {}
  return baseDir
}

function runPython(pythonExe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(pythonExe, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`python exited ${code}`))))
  })
}

export interface PythonToolsOptions {
  pythonVersion: string
  platform: DetectedPlatform
  wheelsDir: string // absolute path to wheelhouse in bundle
  packages?: string[] // defaults to [ 'pipx', 'uv' ]
}

export async function installPythonTools(opts: PythonToolsOptions): Promise<void> {
  const baseDir = toolchainRoot('python', opts.pythonVersion, opts.platform)
  const binDir = process.platform === 'win32' ? baseDir : findBinDir(baseDir)
  const pythonExe =
    process.platform === 'win32' ? join(binDir, 'python.exe') : join(binDir, 'python')
  const pkgs = opts.packages && opts.packages.length > 0 ? opts.packages : ['pipx', 'uv']
  const args = ['-m', 'pip', 'install', '--no-index', '--find-links', opts.wheelsDir, ...pkgs]
  await runPython(pythonExe, args)
}
