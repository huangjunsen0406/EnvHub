import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { DetectedPlatform } from '../platform'
import { toolchainRoot } from '../paths'
import { ArtifactRef } from '../manifest'
import { extractArchive, removeQuarantineAttr } from '../extract'
import { spawn } from 'child_process'
import { logInfo } from '../log'

export interface PythonInstallOptions {
  version: string
  platform: DetectedPlatform
  bundleDir: string
  artifact: ArtifactRef
}

export async function installPython(opts: PythonInstallOptions): Promise<string> {
  const baseDir = toolchainRoot('python', opts.version, opts.platform)
  mkdirSync(baseDir, { recursive: true })

  const archivePath = join(opts.bundleDir, opts.artifact.file)

  // 解压到临时目录
  const tempExtractDir = join(baseDir, 'temp_extract')
  mkdirSync(tempExtractDir, { recursive: true })
  await extractArchive(archivePath, tempExtractDir)

  // python-build-standalone 解压后会有一个 python 目录
  const entries = readdirSync(tempExtractDir)
  const pythonDir = entries.find((e) => e === 'python' || e.startsWith('cpython-'))

  if (pythonDir) {
    // 移动内容
    const extractedPath = join(tempExtractDir, pythonDir)
    const files = readdirSync(extractedPath)
    for (const file of files) {
      const src = join(extractedPath, file)
      const dest = join(baseDir, file)
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true })
      }
      renameSync(src, dest)
    }
  } else {
    // 如果没有子目录，直接移动所有内容
    const files = readdirSync(tempExtractDir)
    for (const file of files) {
      const src = join(tempExtractDir, file)
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

  // Guess binary locations
  const binDir = process.platform === 'win32' ? baseDir : findBinDir(baseDir)

  let finalPythonExe: string

  if (process.platform === 'win32') {
    finalPythonExe = join(binDir, 'python.exe')
  } else {
    // Unix: 优先使用 python，如果不存在则使用 python3
    const pythonPath = join(binDir, 'python')
    const python3Path = join(binDir, 'python3')

    if (existsSync(pythonPath)) {
      finalPythonExe = pythonPath
    } else if (existsSync(python3Path)) {
      // 如果只有 python3，创建 python 符号链接
      try {
        symlinkSync('python3', pythonPath)
        finalPythonExe = pythonPath
      } catch (error) {
        console.warn('Failed to create python symlink:', error)
        finalPythonExe = python3Path
      }
    } else {
      // 都不存在，使用 python3 作为默认值（后续会报错）
      finalPythonExe = python3Path
    }
  }

  // Ensure pip is available
  try {
    await runPython(finalPythonExe, ['-m', 'ensurepip', '--upgrade'])
  } catch (error) {
    console.warn('Failed to ensure pip, it may already be installed:', error)
  }

  // Note: Shims will be created when user activates this version via updateShimsForTool
  return finalPythonExe
}

function findBinDir(baseDir: string): string {
  // Many standalone builds unpack to baseDir or baseDir/<something>
  // Fallback to baseDir if "bin" not found.
  const candidate = join(baseDir, 'bin')
  try {
    // dynamic import to avoid fs/promises
    if (existsSync(candidate)) return candidate
  } catch (e: unknown) {
    logInfo((e as Error).message)
  }
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
