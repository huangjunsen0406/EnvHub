import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { detectPlatform } from './envhub/platform'
import { loadManifest, resolveArtifactPath, selectArtifact } from './envhub/manifest'
import { bundlesManifestPath, toolchainRoot } from './envhub/paths'
import { sha256File } from './envhub/checksum'
import { extractArchive } from './envhub/extract'
import { installPython } from './envhub/installers/python'
import { installNode, installPnpmFromTgz } from './envhub/installers/node'
import {
  installPostgres,
  initDb,
  pgStart,
  createUser,
  createDatabase
} from './envhub/installers/pg'
import { installPgVector } from './envhub/pgvector'
import { logInfo } from './envhub/log'
import { enableAutostartMac, enableAutostartWindows } from './envhub/autostart'
import { spawn } from 'child_process'
import { installPythonTools } from './envhub/installers/python'
import {
  getCurrent,
  listInstalled,
  setCurrent,
  uninstallTool,
  updateShimsForTool
} from './envhub/state'
import { isPathConfigured, addToPath, removeFromPath } from './envhub/path-manager'
import { isPgRunning, pgStop, pgRestart, getPgStatus } from './envhub/pg-manager'
import {
  fetchPythonVersions,
  fetchNodeVersions,
  fetchPostgresVersions
} from './envhub/online/version-fetcher'
import {
  downloadFile,
  cacheDir,
  formatBytes,
  formatTime,
  scanDownloadedInstallers
} from './envhub/online/downloader'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // 文件选择对话框
  ipcMain.handle('envhub:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择离线包目录',
      buttonLabel: '选择'
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // PATH 环境变量管理
  ipcMain.handle('envhub:path:check', () => {
    return isPathConfigured()
  })

  ipcMain.handle('envhub:path:add', async () => {
    logInfo('Adding shims to PATH')
    const result = await addToPath()
    logInfo(result)
    return result
  })

  ipcMain.handle('envhub:path:remove', async () => {
    logInfo('Removing shims from PATH')
    const result = await removeFromPath()
    logInfo(result)
    return result
  })

  // EnvHub IPC handlers (MVP, offline bundle driven)
  ipcMain.handle('envhub:detectPlatform', () => detectPlatform())

  ipcMain.handle('envhub:manifest:load', (_evt, args: { bundleDir: string }) => {
    logInfo(`Loading manifest from ${args.bundleDir}`)
    return loadManifest(bundlesManifestPath(args.bundleDir))
  })

  ipcMain.handle(
    'envhub:installFromBundle',
    async (
      _evt,
      args: {
        bundleDir: string
        python?: string
        node?: string
        pg?: string // full version, e.g. 16.4
        pnpmPathInBundle?: string
      }
    ) => {
      const dp = detectPlatform()
      logInfo(`Detected platform ${JSON.stringify(dp)}`)
      const manifest = loadManifest(bundlesManifestPath(args.bundleDir))
      const result: Record<string, any> = { platform: dp }

      if (args.python) {
        logInfo(`Installing Python ${args.python}`)
        const art = selectArtifact(manifest, 'python', args.python, dp.platformKey)
        // verify hash
        const artifactPath = resolveArtifactPath(args.bundleDir, art)
        const sum = await sha256File(artifactPath)
        if (sum.toLowerCase() !== art.sha256.toLowerCase())
          throw new Error('Python artifact checksum mismatch')
        await installPython({
          version: args.python,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art
        })
        logInfo(`Python ${args.python} installed`)
        result.python = { version: args.python }
      }

      if (args.node) {
        logInfo(`Installing Node ${args.node}`)
        const art = selectArtifact(manifest, 'node', args.node, dp.platformKey)
        const artifactPath = resolveArtifactPath(args.bundleDir, art)
        const sum = await sha256File(artifactPath)
        if (sum.toLowerCase() !== art.sha256.toLowerCase())
          throw new Error('Node artifact checksum mismatch')
        await installNode({
          version: args.node,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art,
          pnpmPathInBundle: args.pnpmPathInBundle
        })
        logInfo(`Node ${args.node} installed`)
        result.node = { version: args.node }
      }

      if (args.pg) {
        logInfo(`Installing PostgreSQL ${args.pg}`)
        const art = selectArtifact(manifest, 'pg', args.pg, dp.platformKey)
        const artifactPath = resolveArtifactPath(args.bundleDir, art)
        const sum = await sha256File(artifactPath)
        if (sum.toLowerCase() !== art.sha256.toLowerCase())
          throw new Error('PostgreSQL artifact checksum mismatch')
        const { binDir, dataDir } = await installPostgres({
          version: args.pg,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art
        })
        logInfo(`PostgreSQL ${args.pg} installed and initialized`)
        if (dataDir) logInfo(`Data directory: ${dataDir}`)
        result.pg = { version: args.pg, binDir, dataDir }
      }

      return result
    }
  )

  // 软件管理：查询已安装、设为当前、卸载、单项安装
  ipcMain.handle('envhub:installed:list', () => {
    const dp = detectPlatform()
    return {
      platform: dp,
      current: getCurrent().current || {},
      python: listInstalled('python', dp),
      node: listInstalled('node', dp),
      pg: listInstalled('pg', dp)
    }
  })

  ipcMain.handle(
    'envhub:use',
    (_evt, args: { tool: 'python' | 'node' | 'pg'; version: string }) => {
      const dp = detectPlatform()
      logInfo(`Use ${args.tool}@${args.version}`)
      updateShimsForTool(args.tool, args.version, dp)
      return { ok: true, current: getCurrent().current }
    }
  )

  ipcMain.handle(
    'envhub:uninstall',
    (_evt, args: { tool: 'python' | 'node' | 'pg'; version: string }) => {
      const dp = detectPlatform()
      logInfo(`Uninstall ${args.tool}@${args.version}`)
      uninstallTool(args.tool, args.version, dp)
      const cur = getCurrent().current || {}
      if (cur[args.tool] === args.version) {
        delete (cur as any)[args.tool]
        setCurrent(args.tool, '')
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:install:one',
    async (_evt, args: { bundleDir: string; tool: 'python' | 'node' | 'pg'; version: string }) => {
      const dp = detectPlatform()
      const manifest = loadManifest(bundlesManifestPath(args.bundleDir))
      logInfo(`Install one ${args.tool}@${args.version}`)
      if (args.tool === 'python') {
        const art = selectArtifact(manifest, 'python', args.version, dp.platformKey)
        const sum = await sha256File(resolveArtifactPath(args.bundleDir, art))
        if (sum.toLowerCase() !== art.sha256.toLowerCase()) throw new Error('checksum mismatch')
        await installPython({
          version: args.version,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art
        })
      } else if (args.tool === 'node') {
        const art = selectArtifact(manifest, 'node', args.version, dp.platformKey)
        const sum = await sha256File(resolveArtifactPath(args.bundleDir, art))
        if (sum.toLowerCase() !== art.sha256.toLowerCase()) throw new Error('checksum mismatch')
        await installNode({
          version: args.version,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art
        })
      } else if (args.tool === 'pg') {
        const art = selectArtifact(manifest, 'pg', args.version, dp.platformKey)
        const sum = await sha256File(resolveArtifactPath(args.bundleDir, art))
        if (sum.toLowerCase() !== art.sha256.toLowerCase()) throw new Error('checksum mismatch')
        const { binDir, dataDir } = await installPostgres({
          version: args.version,
          platform: dp,
          bundleDir: args.bundleDir,
          artifact: art
        })
        logInfo(`PostgreSQL ${args.version} installed and initialized`)
        if (dataDir) logInfo(`Data directory: ${dataDir}`)
        return { ok: true, binDir, dataDir }
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:python:installTools',
    async (
      _evt,
      args: {
        pythonVersion: string
        bundleDir?: string
        wheelsDir?: string
        wheelsDirRelative?: string
        packages?: string[]
      }
    ) => {
      const dp = detectPlatform()
      const wheelsDir =
        args.wheelsDir ||
        (args.bundleDir && args.wheelsDirRelative
          ? resolveArtifactPath(args.bundleDir, { file: args.wheelsDirRelative, sha256: '' })
          : undefined)
      if (!wheelsDir) throw new Error('wheelsDir not provided')
      logInfo(`Installing Python tools ${args.packages?.join(',') || 'pipx,uv'} from ${wheelsDir}`)
      await installPythonTools({
        pythonVersion: args.pythonVersion,
        platform: dp,
        wheelsDir,
        packages: args.packages
      })
      logInfo('Python tools installed')
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:node:installPnpm',
    async (_evt, args: { nodeVersion: string; bundleDir: string; pnpmTgzRelative: string }) => {
      const dp = detectPlatform()
      logInfo(`Installing pnpm from ${args.pnpmTgzRelative}`)
      const entry = await installPnpmFromTgz({
        nodeVersion: args.nodeVersion,
        platform: dp,
        bundleDir: args.bundleDir,
        pnpmTgzRelative: args.pnpmTgzRelative
      })
      logInfo(`pnpm installed, entry ${entry}`)
      return { ok: true, entry }
    }
  )

  ipcMain.handle(
    'envhub:pg:initStart',
    async (
      _evt,
      args: { pgVersion: string; cluster: string; port?: number; auth?: 'scram' | 'md5' }
    ) => {
      const dp = detectPlatform()
      const pgBase = toolchainRoot('pg', args.pgVersion, dp)
      const binDir = process.platform === 'win32' ? `${pgBase}/bin` : `${pgBase}/bin`
      logInfo(`Initializing PostgreSQL cluster ${args.cluster} on ${args.pgVersion}`)
      const dataDir = await initDb(binDir, {
        version: args.pgVersion,
        platform: dp,
        cluster: args.cluster,
        port: args.port,
        auth: args.auth || 'scram'
      })
      logInfo(`Starting PostgreSQL cluster at ${dataDir}`)
      await pgStart(binDir, dataDir)
      return { dataDir, binDir }
    }
  )

  ipcMain.handle(
    'envhub:pg:installVector',
    async (_evt, args: { bundleDir: string; pgVersion: string; pgMajor: string }) => {
      const dp = detectPlatform()
      const manifest = loadManifest(bundlesManifestPath(args.bundleDir))
      const art = selectArtifact(manifest, 'pgvector', args.pgMajor, dp.platformKey)
      const artifactPath = resolveArtifactPath(args.bundleDir, art)
      const sum = await sha256File(artifactPath)
      if (sum.toLowerCase() !== art.sha256.toLowerCase())
        throw new Error('pgvector artifact checksum mismatch')
      const pgBase = toolchainRoot('pg', args.pgVersion, dp)
      logInfo(`Installing pgvector for PG ${args.pgMajor}`)
      await installPgVector({ bundleDir: args.bundleDir, artifact: art, pgRootDir: pgBase })
      logInfo(`pgvector installed`)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:pg:createUserDb',
    async (
      _evt,
      args: { pgVersion: string; dbName: string; username: string; password: string }
    ) => {
      const dp = detectPlatform()
      const pgBase = toolchainRoot('pg', args.pgVersion, dp)
      const binDir = process.platform === 'win32' ? `${pgBase}/bin` : `${pgBase}/bin`
      logInfo(`Creating PG user ${args.username} and db ${args.dbName}`)
      await createUser(binDir, 'postgres', args.username, args.password)
      await createDatabase(binDir, args.dbName, args.username)
      logInfo(`User and database created`)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:pg:enableAutostart',
    async (
      _evt,
      args: { pgVersion: string; cluster: string; dataDir: string; binDir: string; port?: number }
    ) => {
      const dp = detectPlatform()
      const name = `envhub-pg-${args.pgVersion.split('.')[0]}-${args.cluster}`
      const logPath =
        process.platform === 'win32' ? `${args.dataDir}\\pg.log` : `${args.dataDir}/pg.log`
      if (dp.os === 'mac') {
        const plistPath = enableAutostartMac({
          name,
          exec: `${args.binDir}/postgres`,
          args: ['-D', args.dataDir],
          logFile: logPath
        })
        logInfo(`LaunchAgent plist created at ${plistPath}`)
        // load
        await new Promise<void>((resolve, reject) => {
          const p = spawn('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' })
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('launchctl load failed'))))
        })
        logInfo('Autostart enabled (macOS)')
        return { ok: true, plistPath }
      } else {
        const cmd = enableAutostartWindows({
          name,
          exec: `${args.binDir}\\pg_ctl.exe`,
          args: ['start', '-D', args.dataDir, '-l', logPath]
        })
        // run schtasks
        await new Promise<void>((resolve, reject) => {
          const p = spawn(
            'schtasks',
            [
              '/Create',
              '/SC',
              'ONLOGON',
              '/TN',
              name,
              '/TR',
              `"${args.binDir}\\pg_ctl.exe" start -D "${args.dataDir}" -l "${logPath}"`,
              '/RL',
              'HIGHEST',
              '/F'
            ],
            { stdio: 'inherit' }
          )
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('schtasks create failed'))))
        })
        logInfo(`Autostart enabled (Windows). Hint cmd: ${cmd}`)
        return { ok: true }
      }
    }
  )

  ipcMain.handle(
    'envhub:pg:disableAutostart',
    async (_evt, args: { pgVersion: string; cluster: string }) => {
      const dp = detectPlatform()
      const name = `envhub-pg-${args.pgVersion.split('.')[0]}-${args.cluster}`
      if (dp.os === 'mac') {
        const plist = `${process.env.HOME}/Library/LaunchAgents/com.${name}.plist`
        await new Promise<void>((resolve, reject) => {
          const p = spawn('launchctl', ['unload', '-w', plist], { stdio: 'inherit' })
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('launchctl unload failed'))))
        })
        logInfo('Autostart disabled (macOS)')
        return { ok: true }
      } else {
        await new Promise<void>((resolve, reject) => {
          const p = spawn('schtasks', ['/Delete', '/TN', name, '/F'], { stdio: 'inherit' })
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('schtasks delete failed'))))
        })
        logInfo('Autostart disabled (Windows)')
        return { ok: true }
      }
    }
  )

  // 在线安装：获取版本列表
  ipcMain.handle(
    'envhub:online:fetchVersions',
    async (_evt, args: { tool: 'python' | 'node' | 'pg' }) => {
      const dp = detectPlatform()
      logInfo(`Fetching online versions for ${args.tool}`)

      try {
        let versions
        if (args.tool === 'python') {
          versions = await fetchPythonVersions(dp)
        } else if (args.tool === 'node') {
          versions = await fetchNodeVersions(dp)
        } else if (args.tool === 'pg') {
          versions = await fetchPostgresVersions(dp)
        }

        logInfo(`Found ${versions?.length || 0} ${args.tool} versions`)
        return versions
      } catch (error: any) {
        logInfo(`Failed to fetch versions: ${error.message}`)
        throw error
      }
    }
  )

  // 在线安装：下载并安装
  ipcMain.handle(
    'envhub:online:install',
    async (evt, args: { tool: 'python' | 'node' | 'pg'; version: string; url: string }) => {
      const dp = detectPlatform()
      const { tool, version, url } = args

      logInfo(`Starting online install for ${tool} ${version}`)

      // 下载到缓存目录
      const fileName = url.split('/').pop() || `${tool}-${version}.tar.gz`
      const savePath = join(cacheDir(), fileName)

      try {
        // 下载文件（带进度）
        await downloadFile({
          url,
          savePath,
          resume: true,
          onProgress: (progress) => {
            const progressMsg = `下载中... ${progress.percent.toFixed(1)}% (${formatBytes(progress.speed)}/s, 剩余 ${formatTime(progress.eta)})`
            logInfo(progressMsg)
            // 发送进度到渲染进程
            evt.sender.send('envhub:download:progress', {
              tool,
              version,
              downloaded: progress.downloaded,
              total: progress.total,
              percent: progress.percent,
              speed: formatBytes(progress.speed) + '/s',
              eta: formatTime(progress.eta)
            })
          }
        })

        logInfo(`Download completed: ${savePath}`)

        // Python 和 PostgreSQL: 只下载安装器，不自动打开
        if (tool === 'python') {
          logInfo(`Python installer downloaded: ${savePath}`)
          return { ok: true, savePath, message: '安装器已下载' }
        }

        if (tool === 'pg') {
          logInfo(`PostgreSQL installer downloaded: ${savePath}`)
          return { ok: true, savePath, message: '安装器已下载' }
        }

        // Node.js: 自动解压并安装
        logInfo(`Extracting and installing ${tool} ${version}`)

        await installNode({
          version,
          platform: dp,
          bundleDir: cacheDir(),
          artifact: { file: fileName, sha256: '' }
        })

        logInfo(`${tool} ${version} installed successfully`)
        return { ok: true, savePath }
      } catch (error: any) {
        logInfo(`Download failed: ${error.message}`)
        throw error
      }
    }
  )

  // Python 和 PostgreSQL 安装包管理
  ipcMain.handle('envhub:python:openInstaller', async (_evt, args: { path: string }) => {
    logInfo(`Opening Python installer: ${args.path}`)
    await shell.openPath(args.path)
    return { ok: true }
  })

  ipcMain.handle('envhub:python:deleteInstaller', async (_evt, args: { path: string }) => {
    logInfo(`Deleting Python installer: ${args.path}`)
    const fs = require('fs') as typeof import('fs')
    fs.unlinkSync(args.path)
    return { ok: true }
  })

  ipcMain.handle('envhub:pg:openInstaller', async (_evt, args: { path: string }) => {
    logInfo(`Opening PostgreSQL installer: ${args.path}`)
    await shell.openPath(args.path)
    return { ok: true }
  })

  ipcMain.handle('envhub:pg:deleteInstaller', async (_evt, args: { path: string }) => {
    logInfo(`Deleting PostgreSQL installer: ${args.path}`)
    const fs = require('fs') as typeof import('fs')
    fs.unlinkSync(args.path)
    return { ok: true }
  })

  // 扫描下载目录中的安装包
  ipcMain.handle('envhub:scanDownloadedInstallers', () => {
    logInfo('Scanning downloaded installers')
    return scanDownloadedInstallers()
  })

  // PostgreSQL 状态管理
  ipcMain.handle('envhub:pg:status', async (_evt, args: { pgVersion: string; dataDir: string }) => {
    const dp = detectPlatform()
    const pgBase = toolchainRoot('pg', args.pgVersion, dp)
    const binDir = join(pgBase, 'bin')
    return await getPgStatus(binDir, args.dataDir)
  })

  ipcMain.handle('envhub:pg:stop', async (_evt, args: { pgVersion: string; dataDir: string }) => {
    const dp = detectPlatform()
    const pgBase = toolchainRoot('pg', args.pgVersion, dp)
    const binDir = join(pgBase, 'bin')
    logInfo(`Stopping PostgreSQL at ${args.dataDir}`)
    await pgStop(binDir, args.dataDir)
    logInfo('PostgreSQL stopped')
    return { ok: true }
  })

  ipcMain.handle(
    'envhub:pg:restart',
    async (_evt, args: { pgVersion: string; dataDir: string }) => {
      const dp = detectPlatform()
      const pgBase = toolchainRoot('pg', args.pgVersion, dp)
      const binDir = join(pgBase, 'bin')
      logInfo(`Restarting PostgreSQL at ${args.dataDir}`)
      await pgRestart(binDir, args.dataDir)
      logInfo('PostgreSQL restarted')
      return { ok: true }
    }
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
