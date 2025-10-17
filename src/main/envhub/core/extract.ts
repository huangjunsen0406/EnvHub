import { mkdirSync, createWriteStream, readFileSync } from 'fs'
import { Readable } from 'stream'
import { extname, join, dirname } from 'path'
import { spawn } from 'child_process'
import { extract as tarExtract } from 'tar'
import { ZstdCodec } from 'zstd-codec'
import { extract as tarStreamExtract } from 'tar-stream'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: false })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  options?: { strip?: number }
): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const ext = extname(archivePath).toLowerCase()
  const stripLevels = options?.strip ?? 0

  if (ext === '.zip') {
    if (process.platform === 'win32') {
      // Use PowerShell Expand-Archive on Windows
      const cmd = 'powershell'
      const args = [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`
      ]
      await run(cmd, args)
    } else {
      await run('unzip', ['-o', archivePath, '-d', destDir])
    }
    return
  }

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await tarExtract({
      file: archivePath,
      cwd: destDir,
      strip: stripLevels
    })
    return
  }

  if (archivePath.endsWith('.tar.zst')) {
    // 使用 Node.js 包解压 zstd 压缩的 tar 文件
    // 支持 Windows 和 macOS，无需额外安装系统工具
    await extractTarZst(archivePath, destDir, stripLevels)
    return
  }

  if (archivePath.endsWith('.tar')) {
    await tarExtract({
      file: archivePath,
      cwd: destDir,
      strip: stripLevels
    })
    return
  }

  throw new Error(`Unsupported archive format: ${archivePath}`)
}

/**
 * 使用 Node.js 包解压 .tar.zst 文件
 */
async function extractTarZst(archivePath: string, destDir: string, strip = 0): Promise<void> {
  const ZstdCodecModule = await ZstdCodec.run((zstd) => ({
    decompress: (data: Uint8Array) => zstd.decompress(data)
  }))

  return new Promise((resolve, reject) => {
    const fileData = readFileSync(archivePath)
    const decompressed = ZstdCodecModule.decompress(new Uint8Array(fileData))
    const extract = tarStreamExtract()

    extract.on('entry', (header, stream, next) => {
      let pathName = header.name

      // 处理 strip 参数：去掉前 N 级目录
      if (strip > 0) {
        const parts = pathName.split('/').filter((p) => p)
        if (parts.length <= strip) {
          // 跳过顶层目录本身
          stream.resume()
          next()
          return
        }
        pathName = parts.slice(strip).join('/')
      }

      const fullPath = join(destDir, pathName)

      if (header.type === 'directory') {
        mkdirSync(fullPath, { recursive: true })
        stream.resume()
        next()
      } else if (header.type === 'file') {
        mkdirSync(dirname(fullPath), { recursive: true })
        const writeStream = createWriteStream(fullPath, { mode: header.mode })
        stream.pipe(writeStream)
        stream.on('end', next)
        stream.on('error', reject)
      } else {
        stream.resume()
        next()
      }
    })

    extract.on('finish', resolve)
    extract.on('error', reject)

    // Write decompressed data to extract stream
    const readable = Readable.from(Buffer.from(decompressed))
    readable.pipe(extract)
  })
}

export async function removeQuarantineAttr(targetDir: string): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      // 先赋予当前用户写权限（某些文件可能是只读的，导致 xattr 无法修改）
      await new Promise<void>((resolve) => {
        const chmodProcess = spawn('chmod', ['-R', 'u+w', targetDir], {
          stdio: 'ignore',
          shell: false
        })
        chmodProcess.on('error', () => resolve()) // 即使 chmod 失败也继续
        chmodProcess.on('exit', () => resolve())
      })

      // 清除隔离属性
      await new Promise<void>((resolve) => {
        const xattrProcess = spawn('xattr', ['-dr', 'com.apple.quarantine', targetDir], {
          stdio: 'ignore',
          shell: false
        })
        xattrProcess.on('error', () => resolve()) // xattr 不存在时也忽略
        xattrProcess.on('exit', () => resolve()) // 无论退出码如何都成功
      })
    } catch {
      // 完全忽略所有错误
    }
  }
}
