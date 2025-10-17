import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { detectPlatform } from './envhub/core/platform'
import { toolchainRoot, envhubRoot, mysqlDataDir } from './envhub/core/paths'
import { installNode } from './envhub/runtimes/node'
import { installJava } from './envhub/runtimes/java'
import {
  installPostgres,
  initDb,
  pgStart,
  createUser,
  createDatabase
} from './envhub/databases/postgres/installer'
import { installRedis, redisStart, redisStop } from './envhub/databases/redis/installer'
import { installMysql, mysqlStart, mysqlStop } from './envhub/databases/mysql/installer'
import { isMysqlRunning, getMysqlStatus } from './envhub/databases/mysql/manager'
import {
  createMysqlDatabase,
  dropMysqlDatabase,
  listMysqlDatabases,
  backupDatabase,
  restoreDatabase
} from './envhub/databases/mysql/database'
import {
  createMysqlUser,
  dropMysqlUser,
  changeMysqlPassword,
  listMysqlUsers
} from './envhub/databases/mysql/user'
import {
  grantPrivileges,
  revokePrivileges,
  showGrants,
  getUserDatabases
} from './envhub/databases/mysql/grant'
import {
  addDatabaseMetadata as addMysqlDatabaseMetadata,
  deleteDatabaseMetadata as deleteMysqlDatabaseMetadata,
  getAllDatabaseMetadata as getAllMysqlDatabaseMetadata,
  addUserMetadata as addMysqlUserMetadata,
  deleteUserMetadata as deleteMysqlUserMetadata,
  updateUserPassword as updateMysqlUserPassword,
  getAllUserMetadata as getAllMysqlUserMetadata,
  addGrantMetadata,
  deleteGrantMetadata
} from './envhub/databases/mysql/metadata'
import { logInfo } from './envhub/core/log'
import { enableAutostartMac, enableAutostartWindows } from './envhub/env/autostart'
import { spawn, exec } from 'child_process'
import {
  getCurrent,
  listInstalled,
  setCurrent,
  uninstallTool,
  updateShimsForTool
} from './envhub/core/state'
import { isPathConfigured, addToPath, removeFromPath } from './envhub/env/path-manager'
import { isPgRunning, pgStop, getPgStatus } from './envhub/databases/postgres/manager'
import { isRedisRunning, getRedisStatus } from './envhub/databases/redis/manager'
import {
  addDatabaseMetadata,
  getAllDatabaseMetadata,
  updateDatabasePassword,
  deleteDatabaseMetadata
} from './envhub/databases/postgres/metadata'
import {
  fetchPythonVersions,
  fetchNodeVersions,
  fetchPostgresVersions,
  fetchJavaVersions,
  fetchRedisVersions,
  fetchMysqlVersions
} from './envhub/registry/sources'
import {
  downloadFile,
  cacheDir,
  formatBytes,
  formatTime,
  scanDownloadedInstallers
} from './envhub/registry/downloader'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    title: 'EnvHub',
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
  electronApp.setAppUserModelId('com.envhub')

  app.setName('EnvHub')
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => logInfo('Ping received from renderer'))

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

  // 获取用户主目录路径
  ipcMain.handle('envhub:getHomePath', () => {
    return homedir()
  })

  // 软件管理：查询已安装、设为当前、卸载、单项安装
  ipcMain.handle('envhub:installed:list', () => {
    const dp = detectPlatform()
    return {
      platform: dp,
      current: getCurrent().current || {},
      python: listInstalled('python', dp),
      node: listInstalled('node', dp),
      pg: listInstalled('pg', dp),
      java: listInstalled('java', dp),
      redis: listInstalled('redis', dp),
      mysql: listInstalled('mysql', dp)
    }
  })

  ipcMain.handle(
    'envhub:use',
    async (
      _evt,
      args: { tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql'; version: string }
    ) => {
      const dp = detectPlatform()
      logInfo(`Use ${args.tool}@${args.version || '(unset)'}`)

      // Special handling for MySQL: start when set, stop when unset
      if (args.tool === 'mysql') {
        const cur = getCurrent().current?.mysql

        // If unsetting current, stop existing instance first
        if (!args.version) {
          if (cur) {
            try {
              const binDir = join(toolchainRoot('mysql', cur), 'bin')
              const dataDir = join(mysqlDataDir(cur, 'main'), 'data')
              const socketPath = `/tmp/mysql_main_3306.sock`
              logInfo(`Stopping MySQL for unset: ${dataDir}`)
              await mysqlStop(binDir, socketPath)
            } catch (e: unknown) {
              logInfo(`Stop on unset skipped/failed: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          updateShimsForTool('mysql', '', dp)
          return { ok: true, current: getCurrent().current }
        }

        // Switching/setting current: ensure previous instance stopped (to avoid port conflict)
        if (cur && cur !== args.version) {
          try {
            const binOld = join(toolchainRoot('mysql', cur), 'bin')
            const socketPath = `/tmp/mysql_main_3306.sock`
            logInfo(`Stopping previous MySQL: ${cur}`)
            await mysqlStop(binOld, socketPath)
          } catch (e: unknown) {
            logInfo(`Stop previous failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // Write shims for the new version
        updateShimsForTool('mysql', args.version, dp)

        // Ensure MySQL is running for the selected version
        try {
          const binDir = join(toolchainRoot('mysql', args.version), 'bin')
          const baseDir = mysqlDataDir(args.version, 'main')
          const dataDir = join(baseDir, 'data')
          const confPath = join(baseDir, 'my.cnf')
          const running = await isMysqlRunning(dataDir)
          if (!running) {
            logInfo(`Starting MySQL for current version at ${dataDir}`)
            await mysqlStart(binDir, confPath, dataDir)

            // Wait for MySQL to be ready
            await new Promise((resolve) => setTimeout(resolve, 3000))
          }
        } catch (e: unknown) {
          logInfo(`MySQL start failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        return { ok: true, current: getCurrent().current }
      }

      // Special handling for PostgreSQL: start when set, stop when unset
      if (args.tool === 'pg') {
        const cur = getCurrent().current?.pg

        // If unsetting current, stop existing cluster first
        if (!args.version) {
          if (cur) {
            try {
              const base = toolchainRoot('pg', cur)
              const binDir = join(base, 'pgsql', 'bin')
              const { pgDataDir } = await import('./envhub/core/paths')
              const dataDir = pgDataDir(cur, 'main')
              logInfo(`Stopping PostgreSQL for unset: ${dataDir}`)
              await pgStop(binDir, dataDir)
            } catch (e: unknown) {
              logInfo(`Stop on unset skipped/failed: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          updateShimsForTool('pg', '', dp)
          return { ok: true, current: getCurrent().current }
        }

        // Switching/setting current: ensure previous cluster stopped (to avoid port conflict)
        if (cur && cur !== args.version) {
          try {
            const baseOld = toolchainRoot('pg', cur)
            const binOld = join(baseOld, 'pgsql', 'bin')
            const { pgDataDir } = await import('./envhub/core/paths')
            const dataOld = pgDataDir(cur, 'main')
            logInfo(`Stopping previous PostgreSQL: ${dataOld}`)
            await pgStop(binOld, dataOld)
          } catch (e: unknown) {
            logInfo(`Stop previous failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // Write shims for the new version
        updateShimsForTool('pg', args.version, dp)

        // Ensure cluster is running for the selected version
        try {
          const base = toolchainRoot('pg', args.version)
          const binDir = join(base, 'pgsql', 'bin')
          const { pgDataDir } = await import('./envhub/core/paths')
          const dataDir = pgDataDir(args.version, 'main')
          const running = await isPgRunning(dataDir)
          if (!running) {
            const logPath = join(dataDir, 'pg.log')
            logInfo(`Starting PostgreSQL for current version at ${dataDir}`)
            await pgStart(binDir, dataDir, logPath)

            // Wait for PostgreSQL to be ready
            await new Promise((resolve) => setTimeout(resolve, 2000))

            // Create user database on first activation
            try {
              const username = process.env.USER || process.env.USERNAME || 'postgres'
              logInfo(`Creating user database for ${username}`)
              await createDatabase(binDir, username, username)
              logInfo(`User database ${username} created successfully`)
            } catch (dbError: unknown) {
              // Database might already exist, ignore error
              logInfo(
                `Database creation skipped: ${dbError instanceof Error ? dbError.message : String(dbError)}`
              )
            }
          }
        } catch (e: unknown) {
          logInfo(`Start current failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        return { ok: true, current: getCurrent().current }
      }

      // Special handling for Redis: start when set, stop when unset
      if (args.tool === 'redis') {
        const cur = getCurrent().current?.redis
        const defaultPort = 6379

        // If unsetting current, stop existing instance first
        if (!args.version) {
          if (cur) {
            try {
              const base = toolchainRoot('redis', cur)
              const binDir = join(base, dp.platformKey === 'win-x64' ? '' : 'bin')

              // 读取配置文件获取实际端口
              const { redisDataDir } = await import('./envhub/core/paths')
              const { readFile } = await import('fs/promises')
              const dataDir = redisDataDir(cur, 'main')
              const confPath = join(dataDir, 'redis.conf')

              let port = defaultPort
              try {
                const config = await readFile(confPath, 'utf-8')
                const portMatch = config.match(/^port\s+(\d+)/m)
                if (portMatch) {
                  port = parseInt(portMatch[1]) || defaultPort
                }
              } catch {
                // 配置文件读取失败，使用默认端口
              }

              logInfo(`Stopping Redis ${cur} on port ${port}`)
              const { redisStop } = await import('./envhub/databases/redis/manager')
              await redisStop(binDir, port)
            } catch (e: unknown) {
              logInfo(`Stop on unset skipped/failed: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          updateShimsForTool('redis', '', dp)
          return { ok: true, current: getCurrent().current }
        }

        // Switching/setting current: ensure previous instance stopped (to avoid port conflict)
        if (cur && cur !== args.version) {
          try {
            const baseOld = toolchainRoot('redis', cur)
            const binOld = join(baseOld, dp.platformKey === 'win-x64' ? '' : 'bin')

            // 读取旧版本的配置文件获取实际端口
            const { redisDataDir } = await import('./envhub/core/paths')
            const { readFile } = await import('fs/promises')
            const dataOldDir = redisDataDir(cur, 'main')
            const confOldPath = join(dataOldDir, 'redis.conf')

            let oldPort = defaultPort
            try {
              const oldConfig = await readFile(confOldPath, 'utf-8')
              const portMatch = oldConfig.match(/^port\s+(\d+)/m)
              if (portMatch) {
                oldPort = parseInt(portMatch[1]) || defaultPort
              }
            } catch {
              // 配置文件读取失败，使用默认端口
            }

            logInfo(`Stopping previous Redis ${cur} on port ${oldPort}`)
            const { redisStop } = await import('./envhub/databases/redis/manager')
            await redisStop(binOld, oldPort)
          } catch (e: unknown) {
            logInfo(`Stop previous failed: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // Write shims for the new version
        updateShimsForTool('redis', args.version, dp)

        // Ensure Redis is running for the selected version
        try {
          const base = toolchainRoot('redis', args.version)
          const binDir = join(base, dp.platformKey === 'win-x64' ? '' : 'bin')
          const running = await isRedisRunning(defaultPort)
          if (!running) {
            logInfo(`Starting Redis for current version (port ${defaultPort})`)
            const { redisDataDir } = await import('./envhub/core/paths')
            const { generateRedisConf } = await import('./envhub/databases/redis/installer')
            const dataDir = redisDataDir(args.version, 'main')
            const confPath = join(dataDir, 'redis.conf')

            // Generate config if it doesn't exist
            if (!existsSync(confPath)) {
              logInfo(`Generating Redis config for ${args.version}`)
              await generateRedisConf(args.version, 'main', defaultPort)
            }

            await redisStart(binDir, confPath)
          }
        } catch (e: unknown) {
          logInfo(`Start current failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        return { ok: true, current: getCurrent().current }
      }

      // Default behavior for other tools
      updateShimsForTool(args.tool, args.version, dp)
      return { ok: true, current: getCurrent().current }
    }
  )

  ipcMain.handle(
    'envhub:uninstall',
    (_evt, args: { tool: 'python' | 'node' | 'pg' | 'java' | 'redis'; version: string }) => {
      const dp = detectPlatform()
      logInfo(`Uninstall ${args.tool}@${args.version}`)
      uninstallTool(args.tool, args.version, dp)
      const cur = getCurrent().current || {}
      if (cur[args.tool] === args.version) {
        delete (cur as Record<string, unknown>)[args.tool]
        setCurrent(args.tool, '')
      }
      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:pg:initStart',
    async (
      _evt,
      args: { pgVersion: string; cluster: string; port?: number; auth?: 'scram' | 'md5' }
    ) => {
      const dp = detectPlatform()
      const pgBase = toolchainRoot('pg', args.pgVersion)
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
    'envhub:pg:createUserDb',
    async (
      _evt,
      args: { pgVersion: string; dbName: string; username: string; password: string }
    ) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      logInfo(`Creating PG user ${args.username} and db ${args.dbName}`)
      await createUser(binDir, 'postgres', args.username, args.password)
      await createDatabase(binDir, args.dbName, args.username)
      logInfo(`User and database created`)

      // 保存元数据
      addDatabaseMetadata(args.pgVersion, 'main', {
        dbName: args.dbName,
        username: args.username,
        password: args.password,
        note: ''
      })
      logInfo(`Metadata saved for database ${args.dbName}`)

      return { ok: true }
    }
  )

  ipcMain.handle('envhub:pg:listDatabases', async (_evt, args: { pgVersion: string }) => {
    const pgBase = toolchainRoot('pg', args.pgVersion)
    const binDir = join(pgBase, 'pgsql', 'bin')
    const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')

    try {
      const { execSync } = await import('child_process')
      const result = execSync(
        `"${psql}" -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"`,
        { encoding: 'utf8' }
      )
      const databases = result
        .trim()
        .split('\n')
        .filter((name: string) => name && name !== 'postgres')
      return { databases }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Failed to list databases: ${message}`)
      return { databases: [] }
    }
  })

  // 获取数据库列表（带元数据）
  ipcMain.handle(
    'envhub:pg:getDatabasesWithMetadata',
    async (_evt, args: { pgVersion: string }) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')

      try {
        // 查询数据库名和所有者
        const { execSync } = await import('child_process')
        const result = execSync(
          `"${psql}" -d postgres -t -A -c "SELECT d.datname, pg_catalog.pg_get_userbyid(d.datdba) FROM pg_catalog.pg_database d WHERE datistemplate = false ORDER BY datname"`,
          { encoding: 'utf8' }
        )

        const dbList = result
          .trim()
          .split('\n')
          .filter((line: string) => line)
          .map((line: string) => {
            const [dbName, owner] = line.split('|')
            return { dbName, owner }
          })

        // 读取元数据
        const metadata = getAllDatabaseMetadata(args.pgVersion, 'main')

        // 合并数据
        const databases = dbList.map((db) => {
          const meta = metadata.find((m) => m.dbName === db.dbName)
          return {
            dbName: db.dbName,
            username: db.owner,
            password: meta?.password || '',
            note: meta?.note || (db.dbName === 'postgres' ? '管理员' : ''),
            location: '本地数据库'
          }
        })

        // postgres 数据库排第一位
        databases.sort((a, b) => {
          if (a.dbName === 'postgres') return -1
          if (b.dbName === 'postgres') return 1
          return a.dbName.localeCompare(b.dbName)
        })

        return { databases }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logInfo(`Failed to get databases with metadata: ${message}`)
        return { databases: [] }
      }
    }
  )

  // 修改数据库用户密码
  ipcMain.handle(
    'envhub:pg:changePassword',
    async (_evt, args: { pgVersion: string; username: string; newPassword: string }) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')

      try {
        const { execSync } = await import('child_process')
        // 修改 PostgreSQL 用户密码
        execSync(
          `"${psql}" -d postgres -c "ALTER USER ${args.username} WITH PASSWORD '${args.newPassword}'"`,
          { encoding: 'utf8' }
        )

        // 更新元数据
        updateDatabasePassword(args.pgVersion, 'main', args.username, args.newPassword)

        logInfo(`Password changed for user ${args.username}`)
        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '未知错误'
        logInfo(`Failed to change password: ${message}`)
        throw error
      }
    }
  )

  // 删除数据库
  ipcMain.handle(
    'envhub:pg:deleteDatabase',
    async (_evt, args: { pgVersion: string; dbName: string }) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')

      // 防止删除 postgres 数据库
      if (args.dbName === 'postgres') {
        throw new Error('不能删除 postgres 管理员数据库')
      }

      try {
        const { execSync } = await import('child_process')
        // 删除 PostgreSQL 数据库
        execSync(`"${psql}" -d postgres -c "DROP DATABASE ${args.dbName}"`, {
          encoding: 'utf8'
        })

        // 删除元数据
        deleteDatabaseMetadata(args.pgVersion, 'main', args.dbName)

        logInfo(`Database ${args.dbName} deleted`)
        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '未知错误'
        logInfo(`Failed to delete database: ${message}`)
        throw error
      }
    }
  )

  // 选择备份保存路径
  ipcMain.handle('envhub:pg:selectBackupPath', async (_evt, args: { dbName: string }) => {
    const result = await dialog.showSaveDialog({
      title: '选择备份保存位置',
      defaultPath: `${args.dbName}-${new Date().toISOString().split('T')[0]}.sql`,
      filters: [
        { name: 'SQL 备份文件', extensions: ['sql'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    return { canceled: false, filePath: result.filePath }
  })

  // 选择恢复文件
  ipcMain.handle('envhub:pg:selectRestoreFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择备份文件',
      filters: [
        { name: 'SQL 备份文件', extensions: ['sql'] },
        { name: 'PostgreSQL 备份', extensions: ['dump', 'tar'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    return { canceled: false, filePath: result.filePaths[0] }
  })

  // 备份数据库
  ipcMain.handle(
    'envhub:pg:backup',
    async (
      evt,
      args: {
        pgVersion: string
        dbName: string
        username: string
        password: string
        filePath: string
      }
    ) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      const pgDump =
        process.platform === 'win32' ? join(binDir, 'pg_dump.exe') : join(binDir, 'pg_dump')

      logInfo(`Backing up database ${args.dbName} to ${args.filePath}`)

      return new Promise((resolve, reject) => {
        const env = { ...process.env, PGPASSWORD: args.password }
        const child = spawn(
          pgDump,
          [
            '-d',
            args.dbName,
            '-U',
            args.username,
            '-h',
            'localhost',
            '--no-owner',
            '--no-privileges',
            '-f',
            args.filePath
          ],
          { env }
        )

        let errorOutput = ''

        child.stdout?.on('data', (data) => {
          const message = data.toString()
          evt.sender.send('envhub:pg:backup:log', message)
        })

        child.stderr?.on('data', (data) => {
          const message = data.toString()
          errorOutput += message
          evt.sender.send('envhub:pg:backup:log', message)
        })

        child.on('close', (code) => {
          if (code === 0) {
            logInfo(`Backup completed: ${args.filePath}`)
            resolve({ ok: true, filePath: args.filePath })
          } else {
            const error = `Backup failed with code ${code}: ${errorOutput}`
            logInfo(error)
            reject(new Error(error))
          }
        })

        child.on('error', (err) => {
          logInfo(`Backup error: ${err.message}`)
          reject(err)
        })
      })
    }
  )

  // 恢复/导入数据库
  ipcMain.handle(
    'envhub:pg:restore',
    async (
      evt,
      args: {
        pgVersion: string
        dbName: string
        username: string
        password: string
        filePath: string
      }
    ) => {
      const pgBase = toolchainRoot('pg', args.pgVersion)
      const binDir = join(pgBase, 'pgsql', 'bin')
      const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')

      logInfo(`Restoring database ${args.dbName} from ${args.filePath}`)

      return new Promise((resolve, reject) => {
        const env = { ...process.env, PGPASSWORD: args.password }
        const child = spawn(
          psql,
          [
            '-d',
            args.dbName,
            '-U',
            args.username,
            '-h',
            'localhost',
            '-f',
            args.filePath,
            '--single-transaction',
            '--set',
            'ON_ERROR_STOP=on'
          ],
          { env }
        )

        let errorOutput = ''

        child.stdout?.on('data', (data) => {
          const message = data.toString()
          evt.sender.send('envhub:pg:restore:log', message)
        })

        child.stderr?.on('data', (data) => {
          const message = data.toString()
          errorOutput += message
          evt.sender.send('envhub:pg:restore:log', message)
        })

        child.on('close', (code) => {
          if (code === 0) {
            logInfo(`Restore completed: ${args.dbName}`)
            resolve({ ok: true })
          } else {
            const error = `Restore failed with code ${code}: ${errorOutput}`
            logInfo(error)
            reject(new Error(error))
          }
        })

        child.on('error', (err) => {
          logInfo(`Restore error: ${err.message}`)
          reject(err)
        })
      })
    }
  )

  ipcMain.handle(
    'envhub:pg:enableAutostart',
    async (
      _evt,
      args: { pgVersion: string; cluster: string; dataDir: string; binDir: string; port?: number }
    ) => {
      const dp = detectPlatform()
      const name = `envhub-pg-${args.pgVersion.replace(/\./g, '-')}-${args.cluster}`
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
      const name = `envhub-pg-${args.pgVersion.replace(/\./g, '-')}-${args.cluster}`
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
    async (
      _evt,
      args: {
        tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql'
        forceRefresh?: boolean
        distribution?: string
      }
    ) => {
      const dp = detectPlatform()
      const forceRefresh = args.forceRefresh || false
      logInfo(`Fetching online versions for ${args.tool}${forceRefresh ? ' (force refresh)' : ''}`)

      try {
        let versions
        if (args.tool === 'python') {
          versions = await fetchPythonVersions(dp, forceRefresh)
        } else if (args.tool === 'node') {
          versions = await fetchNodeVersions(dp, forceRefresh)
        } else if (args.tool === 'pg') {
          versions = await fetchPostgresVersions(dp, forceRefresh)
        } else if (args.tool === 'java') {
          versions = await fetchJavaVersions(
            dp,
            (args.distribution as
              | 'temurin'
              | 'oracle'
              | 'corretto'
              | 'graalvm'
              | 'zulu'
              | 'liberica'
              | 'microsoft') || 'temurin',
            forceRefresh
          )
        } else if (args.tool === 'redis') {
          versions = await fetchRedisVersions(dp, forceRefresh)
        } else if (args.tool === 'mysql') {
          versions = await fetchMysqlVersions(dp, forceRefresh)
        }

        logInfo(`Found ${versions?.length || 0} ${args.tool} versions`)
        return versions
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logInfo(`Failed to fetch versions: ${message}`)
        throw error
      }
    }
  )

  // 在线安装：下载并安装
  ipcMain.handle(
    'envhub:online:install',
    async (
      evt,
      args: {
        tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql'
        version: string
        url: string
      }
    ) => {
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

        // 自动解压并安装所有工具（包括 Python）
        logInfo(`Extracting and installing ${tool} ${version}`)

        if (tool === 'python') {
          const { installPython } = await import('./envhub/runtimes/python')
          await installPython({
            version,
            platform: dp,
            archivePath: savePath
          })
        } else if (tool === 'node') {
          await installNode({
            version,
            platform: dp,
            archivePath: savePath
          })
        } else if (tool === 'pg') {
          await installPostgres({
            version,
            platform: dp,
            archivePath: savePath
          })
        } else if (tool === 'java') {
          await installJava({
            version,
            platform: dp,
            archivePath: savePath
          })
        } else if (tool === 'redis') {
          await installRedis({
            version,
            platform: dp.platformKey,
            archivePath: savePath
          })
        } else if (tool === 'mysql') {
          await installMysql({
            version,
            platform: dp,
            archivePath: savePath
          })
        }

        // All tools require manual activation via "Use" button
        logInfo(`${tool} ${version} installed successfully`)
        // Note: User needs to click "启用" button to activate the installed version

        return { ok: true, savePath }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logInfo(`Download failed: ${message}`)
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
    unlinkSync(args.path)
    return { ok: true }
  })

  // 扫描下载目录中的安装包
  ipcMain.handle('envhub:scanDownloadedInstallers', () => {
    logInfo('Scanning downloaded installers')
    return scanDownloadedInstallers()
  })

  // PostgreSQL 状态管理
  ipcMain.handle('envhub:pg:status', async (_evt, args: { pgVersion: string; dataDir: string }) => {
    const pgBase = toolchainRoot('pg', args.pgVersion)
    const binDir = join(pgBase, 'pgsql', 'bin')
    const home = process.env.HOME || homedir()
    const dataDir = args.dataDir?.startsWith('~/')
      ? join(home, args.dataDir.slice(2))
      : args.dataDir
    return await getPgStatus(binDir, dataDir)
  })

  // Redis 状态管理
  ipcMain.handle(
    'envhub:redis:status',
    async (_evt, args: { redisVersion: string; port?: number }) => {
      let port = args.port || 6379

      // 尝试从配置文件读取实际端口
      if (!args.port) {
        try {
          const { redisDataDir } = await import('./envhub/core/paths')
          const { readFile } = await import('fs/promises')
          const dataDir = redisDataDir(args.redisVersion, 'main')
          const confPath = join(dataDir, 'redis.conf')
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) {
            port = parseInt(portMatch[1], 10)
          }
        } catch {
          // 使用默认端口
        }
      }

      logInfo(`Checking Redis status on port ${port}`)
      return await getRedisStatus(port)
    }
  )

  // Redis 在线版本获取
  ipcMain.handle('envhub:redis:fetchVersions', async (_evt, forceRefresh = false) => {
    const platform = detectPlatform()
    logInfo(`Fetching Redis versions for ${platform.platformKey}`)
    return await fetchRedisVersions(platform, forceRefresh)
  })

  // Redis 下载并安装
  ipcMain.handle(
    'envhub:redis:install',
    async (_evt, args: { version: string; cluster?: string; port?: number }) => {
      const platform = detectPlatform()
      logInfo(`Installing Redis ${args.version} on ${platform.platformKey}`)

      // 1. 获取下载 URL
      const versions = await fetchRedisVersions(platform)
      const versionInfo = versions.find((v) => v.version === args.version)
      if (!versionInfo) {
        throw new Error(`Redis ${args.version} not found`)
      }

      // 2. 下载到缓存
      const ext = versionInfo.url.endsWith('.zip') ? '.zip' : '.tar.gz'
      const savePath = join(cacheDir(), `redis-${args.version}-${platform.platformKey}${ext}`)

      await downloadFile({
        url: versionInfo.url,
        savePath,
        onProgress: (progress) => {
          // 发送下载进度到渲染进程
          BrowserWindow.getAllWindows()[0]?.webContents.send('download-progress', {
            tool: 'redis',
            version: args.version,
            ...progress
          })
        }
      })

      // 3. 安装
      const result = await installRedis({
        version: args.version,
        platform: platform.platformKey,
        archivePath: savePath,
        cluster: args.cluster,
        port: args.port
      })

      logInfo(`Redis ${args.version} installed successfully`)
      return result
    }
  )

  // Redis 卸载
  ipcMain.handle('envhub:redis:uninstall', async (_evt, version: string) => {
    const platform = detectPlatform()
    logInfo(`Uninstalling Redis ${version}`)
    await uninstallTool('redis', version, platform)
    return { ok: true }
  })

  // Redis 设置为当前版本
  ipcMain.handle('envhub:redis:setCurrent', async (_evt, version: string) => {
    const platform = detectPlatform()
    logInfo(`Setting Redis ${version} as current`)
    await setCurrent('redis', version)
    await updateShimsForTool('redis', version, platform)
    return { ok: true }
  })

  // Redis 启动
  ipcMain.handle(
    'envhub:redis:start',
    async (_evt, args: { version: string; confPath: string }) => {
      const platform = detectPlatform()
      const binDir = join(
        toolchainRoot('redis', args.version),
        platform.platformKey === 'win-x64' ? '' : 'bin'
      )
      logInfo(`Starting Redis ${args.version}`)
      await redisStart(binDir, args.confPath)
      return { ok: true }
    }
  )

  // Redis 停止
  ipcMain.handle('envhub:redis:stop', async (_evt, args: { version: string; port: number }) => {
    const platform = detectPlatform()
    const binDir = join(
      toolchainRoot('redis', args.version),
      platform.platformKey === 'win-x64' ? '' : 'bin'
    )
    logInfo(`Stopping Redis ${args.version} on port ${args.port}`)
    await redisStop(binDir, args.port)
    return { ok: true }
  })

  // Redis 自启动配置
  ipcMain.handle(
    'envhub:redis:enableAutostart',
    async (
      _evt,
      args: {
        redisVersion: string
        cluster: string
        confPath: string
        binDir: string
        port?: number
      }
    ) => {
      const dp = detectPlatform()
      const name = `envhub-redis-${args.redisVersion.split('.')[0]}-${args.cluster}`
      const logDir = join(
        envhubRoot(),
        'logs',
        'redis',
        args.redisVersion.split('.')[0],
        args.cluster
      )
      mkdirSync(logDir, { recursive: true })
      const logPath = process.platform === 'win32' ? `${logDir}\\redis.log` : `${logDir}/redis.log`

      if (dp.os === 'mac') {
        const plistPath = enableAutostartMac({
          name,
          exec: `${args.binDir}/redis-server`,
          args: [args.confPath],
          logFile: logPath
        })
        logInfo(`LaunchAgent plist created at ${plistPath}`)
        // load
        await new Promise<void>((resolve, reject) => {
          const p = spawn('launchctl', ['load', '-w', plistPath], { stdio: 'inherit' })
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('launchctl load failed'))))
        })
        logInfo('Redis autostart enabled (macOS)')
        return { ok: true, plistPath }
      } else {
        const cmd = enableAutostartWindows({
          name,
          exec: `${args.binDir}\\redis-server.exe`,
          args: [args.confPath]
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
              `"${args.binDir}\\redis-server.exe" "${args.confPath}"`,
              '/RL',
              'HIGHEST',
              '/F'
            ],
            { stdio: 'inherit' }
          )
          p.on('error', reject)
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('schtasks /Create failed'))))
        })
        logInfo(`Redis autostart enabled (Windows): ${cmd}`)
        return { ok: true, cmd }
      }
    }
  )

  // Redis 打开终端
  ipcMain.handle(
    'envhub:redis:openTerminal',
    async (_evt, args: { version: string; port?: number }) => {
      const platform = detectPlatform()

      // 如果没有指定端口，从配置文件读取
      let port = args.port || 6379
      if (!args.port) {
        try {
          const { redisDataDir } = await import('./envhub/core/paths')
          const { readFile } = await import('fs/promises')
          const dataDir = redisDataDir(args.version, 'main')
          const confPath = join(dataDir, 'redis.conf')
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) {
            port = parseInt(portMatch[1], 10)
          }
        } catch {
          // 使用默认端口
        }
      }

      const binDir = join(
        toolchainRoot('redis', args.version),
        platform.platformKey === 'win-x64' ? '' : 'bin'
      )
      const cliExe =
        platform.platformKey === 'win-x64'
          ? join(binDir, 'redis-cli.exe')
          : join(binDir, 'redis-cli')

      logInfo(`Opening Redis CLI for version ${args.version} on port ${port}`)

      if (platform.os === 'mac') {
        // macOS: 使用 AppleScript 打开新的 Terminal 窗口
        const script = `tell application "Terminal"
        activate
        do script "cd ~ && '${cliExe}' -p ${port}"
      end tell`
        exec(`osascript -e '${script}'`)
      } else if (platform.os === 'win') {
        // Windows: 使用 cmd 打开新窗口
        spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `"${cliExe}" -p ${port}`], {
          detached: true,
          stdio: 'ignore'
        })
      } else {
        // Linux: 尝试使用常见的终端模拟器
        try {
          spawn('x-terminal-emulator', ['-e', `${cliExe} -p ${port}`], {
            detached: true,
            stdio: 'ignore'
          })
        } catch {
          spawn('xterm', ['-e', `${cliExe} -p ${port}`], {
            detached: true,
            stdio: 'ignore'
          })
        }
      }

      return { ok: true }
    }
  )

  // Redis 重启
  ipcMain.handle('envhub:redis:restart', async (_evt, args: { version: string }) => {
    const platform = detectPlatform()
    const base = toolchainRoot('redis', args.version)
    const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

    logInfo(`Restarting Redis ${args.version}`)

    try {
      // 读取配置文件获取端口
      const { redisDataDir } = await import('./envhub/core/paths')
      const { readFile } = await import('fs/promises')
      const dataDir = redisDataDir(args.version, 'main')
      const confPath = join(dataDir, 'redis.conf')

      let port = 6379 // 默认端口
      try {
        const content = await readFile(confPath, 'utf-8')
        const portMatch = content.match(/^port\s+(\d+)/m)
        if (portMatch) {
          port = parseInt(portMatch[1])
        }
      } catch {
        // 使用默认端口
      }

      // 先停止
      const { redisStop } = await import('./envhub/databases/redis/manager')
      await redisStop(binDir, port)

      // 等待停止完成
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 重新启动
      await redisStart(binDir, confPath)

      logInfo(`Redis ${args.version} restarted successfully`)
      return { ok: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Failed to restart Redis: ${message}`)
      throw error
    }
  })

  // Redis 重载配置
  ipcMain.handle('envhub:redis:reload', async (_evt, args: { version: string }) => {
    const platform = detectPlatform()
    const base = toolchainRoot('redis', args.version)
    const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

    logInfo(`Reloading Redis ${args.version} config`)

    try {
      // 读取配置文件获取端口
      const { redisDataDir } = await import('./envhub/core/paths')
      const { readFile } = await import('fs/promises')
      const dataDir = redisDataDir(args.version, 'main')
      const confPath = join(dataDir, 'redis.conf')

      let port = 6379 // 默认端口
      try {
        const content = await readFile(confPath, 'utf-8')
        const portMatch = content.match(/^port\s+(\d+)/m)
        if (portMatch) {
          port = parseInt(portMatch[1])
        }
      } catch {
        // 使用默认端口
      }

      // 先检查 Redis 是否在运行
      const running = await isRedisRunning(port)
      if (!running) {
        throw new Error('Redis 未运行，无法重载配置。请先启用 Redis。')
      }

      const cliExe =
        platform.platformKey === 'win-x64'
          ? join(binDir, 'redis-cli.exe')
          : join(binDir, 'redis-cli')

      // 使用 redis-cli 发送 CONFIG REWRITE 命令重载配置
      const { execSync } = await import('child_process')
      execSync(`"${cliExe}" -p ${port} CONFIG REWRITE`, { encoding: 'utf8' })

      logInfo(`Redis ${args.version} config reloaded successfully`)
      return { ok: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logInfo(`Failed to reload Redis config: ${message}`)
      throw new Error(`重载配置失败: ${message}`)
    }
  })

  // Redis 获取配置文件
  ipcMain.handle('envhub:redis:getConfig', async (_evt, args: { version: string }) => {
    const { redisDataDir } = await import('./envhub/core/paths')
    const { readFile } = await import('fs/promises')
    const dataDir = redisDataDir(args.version, 'main')
    const confPath = join(dataDir, 'redis.conf')

    try {
      const content = await readFile(confPath, 'utf-8')

      // 解析配置文件中的关键配置项
      const config: Record<string, string | number> = {}

      const bindMatch = content.match(/^bind\s+(.+)/m)
      if (bindMatch) config.bind = bindMatch[1].trim()

      const portMatch = content.match(/^port\s+(\d+)/m)
      if (portMatch) config.port = parseInt(portMatch[1])

      const timeoutMatch = content.match(/^timeout\s+(\d+)/m)
      if (timeoutMatch) config.timeout = parseInt(timeoutMatch[1])

      const maxclientsMatch = content.match(/^maxclients\s+(\d+)/m)
      if (maxclientsMatch) config.maxclients = parseInt(maxclientsMatch[1])

      const databasesMatch = content.match(/^databases\s+(\d+)/m)
      if (databasesMatch) config.databases = parseInt(databasesMatch[1])

      const requirepassMatch = content.match(/^requirepass\s+(.+)/m)
      if (requirepassMatch) config.requirepass = requirepassMatch[1].trim()

      const maxmemoryMatch = content.match(/^maxmemory\s+(.+)/m)
      if (maxmemoryMatch) config.maxmemory = maxmemoryMatch[1].trim()

      return { ok: true, content, dataDir, config }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`读取配置文件失败: ${message}`)
    }
  })

  // Redis 保存配置文件
  ipcMain.handle(
    'envhub:redis:saveConfig',
    async (_evt, args: { version: string; content: string }) => {
      const { redisDataDir } = await import('./envhub/core/paths')
      const { writeFile } = await import('fs/promises')
      const dataDir = redisDataDir(args.version, 'main')
      const confPath = join(dataDir, 'redis.conf')

      try {
        await writeFile(confPath, args.content, 'utf-8')
        logInfo(`Redis config saved for version ${args.version}`)
        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`保存配置文件失败: ${message}`)
      }
    }
  )

  // Redis 更新配置项
  ipcMain.handle(
    'envhub:redis:updateConfig',
    async (
      _evt,
      args: { version: string; config: Record<string, unknown>; removeKeys?: string[] }
    ) => {
      const { redisDataDir } = await import('./envhub/core/paths')
      const { readFile, writeFile } = await import('fs/promises')
      const dataDir = redisDataDir(args.version, 'main')
      const confPath = join(dataDir, 'redis.conf')

      try {
        const content = await readFile(confPath, 'utf-8')
        let lines = content.split('\n')

        // 移除可能冲突的 ACL 配置（CONFIG REWRITE 自动生成的）
        // Redis 6.0+ 的 ACL 会覆盖 requirepass
        lines = lines.filter(
          (line) =>
            !line.trim().startsWith('user default') &&
            !line.trim().startsWith('latency-tracking-info-percentiles')
        )

        // 移除指定的配置项（例如取消密码）
        if (args.removeKeys && args.removeKeys.length > 0) {
          lines = lines.filter((line) => {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) return true
            return !args.removeKeys!.some((key) => trimmed.startsWith(`${key} `) || trimmed === key)
          })
          logInfo(`Redis config removed keys: ${args.removeKeys.join(', ')}`)
        }

        // 更新或添加配置项
        for (const [key, value] of Object.entries(args.config)) {
          const configLine = `${key} ${value}`

          // 查找配置项（跳过注释行）
          let foundIndex = -1
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim()
            // 跳过空行和注释
            if (!trimmed || trimmed.startsWith('#')) continue
            // 检查是否是目标配置项
            if (trimmed.startsWith(`${key} `) || trimmed === key) {
              foundIndex = i
              break
            }
          }

          if (foundIndex >= 0) {
            // 更新现有配置
            lines[foundIndex] = configLine
          } else {
            // 添加新配置（在文件末尾添加，带注释说明）
            lines.push(`# Added by EnvHub`)
            lines.push(configLine)
          }
        }

        await writeFile(confPath, lines.join('\n'), 'utf-8')
        logInfo(
          `Redis config updated for version ${args.version}: ${Object.keys(args.config).join(', ')}`
        )
        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`更新配置失败: ${message}`)
      }
    }
  )

  // Redis 获取运行信息
  ipcMain.handle('envhub:redis:info', async (_evt, args: { version: string }) => {
    const platform = detectPlatform()
    const base = toolchainRoot('redis', args.version)
    const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

    try {
      // 读取配置文件获取端口和密码
      const { redisDataDir } = await import('./envhub/core/paths')
      const { readFile } = await import('fs/promises')
      const dataDir = redisDataDir(args.version, 'main')
      const confPath = join(dataDir, 'redis.conf')

      let port = 6379 // 默认端口
      let password = ''
      try {
        const content = await readFile(confPath, 'utf-8')
        const portMatch = content.match(/^port\s+(\d+)/m)
        if (portMatch) {
          port = parseInt(portMatch[1])
        }
        const passMatch = content.match(/^requirepass\s+(.+)/m)
        if (passMatch) {
          password = passMatch[1].trim()
        }
      } catch {
        // 使用默认值
      }

      const running = await isRedisRunning(port)
      if (!running) {
        throw new Error('Redis 未运行')
      }

      const cliExe =
        platform.platformKey === 'win-x64'
          ? join(binDir, 'redis-cli.exe')
          : join(binDir, 'redis-cli')

      const { execSync } = await import('child_process')

      // 使用数组参数避免命令注入和转义问题
      let info: string
      if (password) {
        // 有密码：使用 -a 参数（警告信息会输出到 stderr）
        info = execSync(`"${cliExe}" -p ${port} -a "${password}" INFO 2>/dev/null`, {
          encoding: 'utf8'
        })
      } else {
        // 无密码
        info = execSync(`"${cliExe}" -p ${port} INFO`, { encoding: 'utf8' })
      }

      return { ok: true, info }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`获取 Redis 信息失败: ${message}`)
    }
  })

  // Redis 数据浏览 - 获取键列表
  ipcMain.handle(
    'envhub:redis:keys',
    async (_evt, args: { version: string; db: number; pattern?: string }) => {
      const platform = detectPlatform()
      const base = toolchainRoot('redis', args.version)
      const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

      try {
        // 读取配置文件获取端口和密码
        const { redisDataDir } = await import('./envhub/core/paths')
        const { readFile } = await import('fs/promises')
        const dataDir = redisDataDir(args.version, 'main')
        const confPath = join(dataDir, 'redis.conf')

        let port = 6379
        let password = ''
        try {
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) port = parseInt(portMatch[1])
          const passMatch = content.match(/^requirepass\s+(.+)/m)
          if (passMatch) password = passMatch[1].trim()
        } catch {
          // 使用默认值
        }

        const cliExe =
          platform.platformKey === 'win-x64'
            ? join(binDir, 'redis-cli.exe')
            : join(binDir, 'redis-cli')

        const { execSync } = await import('child_process')
        const pattern = args.pattern || '*'

        // 获取键列表
        const authParam = password ? `-a "${password}"` : ''
        const keysOutput = execSync(
          `"${cliExe}" -p ${port} ${authParam} -n ${args.db} --scan --pattern "${pattern}" 2>/dev/null`,
          { encoding: 'utf8' }
        )

        const keyNames = keysOutput
          .trim()
          .split('\n')
          .filter((k) => k)

        // 获取每个键的详细信息
        const keys = await Promise.all(
          keyNames.map(async (keyName) => {
            try {
              const typeOut = execSync(
                `"${cliExe}" -p ${port} ${authParam} -n ${args.db} TYPE "${keyName}" 2>/dev/null`,
                { encoding: 'utf8' }
              ).trim()

              const ttlOut = execSync(
                `"${cliExe}" -p ${port} ${authParam} -n ${args.db} TTL "${keyName}" 2>/dev/null`,
                { encoding: 'utf8' }
              ).trim()

              // 获取值大小（字节）
              let size = 0
              if (typeOut === 'string') {
                const strlen = execSync(
                  `"${cliExe}" -p ${port} ${authParam} -n ${args.db} STRLEN "${keyName}" 2>/dev/null`,
                  { encoding: 'utf8' }
                ).trim()
                size = parseInt(strlen) || 0
              }

              return {
                name: keyName,
                type: typeOut,
                ttl: parseInt(ttlOut),
                size,
                value: '' // 不在列表中获取值，点击编辑时再获取
              }
            } catch {
              return { name: keyName, type: 'unknown', ttl: -1, size: 0, value: '' }
            }
          })
        )

        return { ok: true, keys }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`获取键列表失败: ${message}`)
      }
    }
  )

  // Redis 数据浏览 - 获取键值
  ipcMain.handle(
    'envhub:redis:get',
    async (_evt, args: { version: string; db: number; key: string }) => {
      const platform = detectPlatform()
      const base = toolchainRoot('redis', args.version)
      const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

      try {
        const { redisDataDir } = await import('./envhub/core/paths')
        const { readFile } = await import('fs/promises')
        const dataDir = redisDataDir(args.version, 'main')
        const confPath = join(dataDir, 'redis.conf')

        let port = 6379
        let password = ''
        try {
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) port = parseInt(portMatch[1])
          const passMatch = content.match(/^requirepass\s+(.+)/m)
          if (passMatch) password = passMatch[1].trim()
        } catch {
          // 使用默认值
        }

        const cliExe =
          platform.platformKey === 'win-x64'
            ? join(binDir, 'redis-cli.exe')
            : join(binDir, 'redis-cli')

        const { execSync } = await import('child_process')
        const authParam = password ? `-a "${password}"` : ''

        // 获取类型
        const typeOut = execSync(
          `"${cliExe}" -p ${port} ${authParam} -n ${args.db} TYPE "${args.key}" 2>/dev/null`,
          { encoding: 'utf8' }
        ).trim()

        // 获取TTL
        const ttlOut = execSync(
          `"${cliExe}" -p ${port} ${authParam} -n ${args.db} TTL "${args.key}" 2>/dev/null`,
          { encoding: 'utf8' }
        ).trim()

        // 获取值
        let value = ''
        if (typeOut === 'string') {
          value = execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} GET "${args.key}" 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim()
        } else if (typeOut === 'hash') {
          // Hash 类型 - 格式：field1 value1 field2 value2
          const hashOut = execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} HGETALL "${args.key}" 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim()
          value = hashOut.split('\n').join(' ')
        } else if (typeOut === 'list') {
          // List 类型 - 格式：value1 value2 value3
          const listOut = execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} LRANGE "${args.key}" 0 -1 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim()
          value = listOut.split('\n').join(' ')
        } else if (typeOut === 'set') {
          // Set 类型 - 格式：member1 member2 member3
          const setOut = execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} SMEMBERS "${args.key}" 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim()
          value = setOut.split('\n').join(' ')
        } else if (typeOut === 'zset') {
          // Sorted Set 类型 - 格式：score1 member1 score2 member2
          const zsetOut = execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} ZRANGE "${args.key}" 0 -1 WITHSCORES 2>/dev/null`,
            { encoding: 'utf8' }
          ).trim()
          // Redis 返回格式是每行一个元素（member/score交替）
          const lines = zsetOut.split('\n')
          const pairs: string[] = []
          for (let i = 0; i < lines.length; i += 2) {
            if (i + 1 < lines.length) {
              // score member（与 ZADD 的顺序一致）
              pairs.push(lines[i + 1], lines[i])
            }
          }
          value = pairs.join(' ')
        }

        return {
          ok: true,
          name: args.key,
          type: typeOut,
          value,
          ttl: parseInt(ttlOut)
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`获取键值失败: ${message}`)
      }
    }
  )

  // Redis 数据浏览 - 设置键值
  ipcMain.handle(
    'envhub:redis:set',
    async (
      _evt,
      args: {
        version: string
        db: number
        key: string
        value: string
        type: string
        ttl?: number
      }
    ) => {
      const platform = detectPlatform()
      const base = toolchainRoot('redis', args.version)
      const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

      try {
        const { redisDataDir } = await import('./envhub/core/paths')
        const { readFile } = await import('fs/promises')
        const dataDir = redisDataDir(args.version, 'main')
        const confPath = join(dataDir, 'redis.conf')

        let port = 6379
        let password = ''
        try {
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) port = parseInt(portMatch[1])
          const passMatch = content.match(/^requirepass\s+(.+)/m)
          if (passMatch) password = passMatch[1].trim()
        } catch {
          // 使用默认值
        }

        const cliExe =
          platform.platformKey === 'win-x64'
            ? join(binDir, 'redis-cli.exe')
            : join(binDir, 'redis-cli')

        const { execSync } = await import('child_process')
        const authParam = password ? `-a "${password}"` : ''

        // 根据数据类型设置值
        if (args.type === 'string') {
          // String 类型
          if (args.ttl && args.ttl > 0) {
            execSync(
              `"${cliExe}" -p ${port} ${authParam} -n ${args.db} SET "${args.key}" "${args.value}" EX ${args.ttl} 2>/dev/null`,
              { encoding: 'utf8' }
            )
          } else {
            execSync(
              `"${cliExe}" -p ${port} ${authParam} -n ${args.db} SET "${args.key}" "${args.value}" 2>/dev/null`,
              { encoding: 'utf8' }
            )
          }
        } else if (args.type === 'hash') {
          // Hash 类型 - 值格式: field1 value1 field2 value2
          execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} HSET "${args.key}" ${args.value} 2>/dev/null`,
            { encoding: 'utf8' }
          )
        } else if (args.type === 'list') {
          // List 类型 - 值格式: value1 value2 value3
          const values = args.value.split(/\s+/).filter((v) => v)
          for (const val of values) {
            execSync(
              `"${cliExe}" -p ${port} ${authParam} -n ${args.db} RPUSH "${args.key}" "${val}" 2>/dev/null`,
              { encoding: 'utf8' }
            )
          }
        } else if (args.type === 'set') {
          // Set 类型 - 值格式: member1 member2 member3
          const members = args.value.split(/\s+/).filter((v) => v)
          for (const member of members) {
            execSync(
              `"${cliExe}" -p ${port} ${authParam} -n ${args.db} SADD "${args.key}" "${member}" 2>/dev/null`,
              { encoding: 'utf8' }
            )
          }
        } else if (args.type === 'zset') {
          // Sorted Set 类型 - 值格式: score1 member1 score2 member2
          execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} ZADD "${args.key}" ${args.value} 2>/dev/null`,
            { encoding: 'utf8' }
          )
        }

        // 设置 TTL（如果指定）
        if (args.ttl && args.ttl > 0 && args.type !== 'string') {
          execSync(
            `"${cliExe}" -p ${port} ${authParam} -n ${args.db} EXPIRE "${args.key}" ${args.ttl} 2>/dev/null`,
            { encoding: 'utf8' }
          )
        }

        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`设置键值失败: ${message}`)
      }
    }
  )

  // Redis 数据浏览 - 删除键
  ipcMain.handle(
    'envhub:redis:del',
    async (_evt, args: { version: string; db: number; key: string }) => {
      const platform = detectPlatform()
      const base = toolchainRoot('redis', args.version)
      const binDir = join(base, platform.platformKey === 'win-x64' ? '' : 'bin')

      try {
        const { redisDataDir } = await import('./envhub/core/paths')
        const { readFile } = await import('fs/promises')
        const dataDir = redisDataDir(args.version, 'main')
        const confPath = join(dataDir, 'redis.conf')

        let port = 6379
        let password = ''
        try {
          const content = await readFile(confPath, 'utf-8')
          const portMatch = content.match(/^port\s+(\d+)/m)
          if (portMatch) port = parseInt(portMatch[1])
          const passMatch = content.match(/^requirepass\s+(.+)/m)
          if (passMatch) password = passMatch[1].trim()
        } catch {
          // 使用默认值
        }

        const cliExe =
          platform.platformKey === 'win-x64'
            ? join(binDir, 'redis-cli.exe')
            : join(binDir, 'redis-cli')

        const { execSync } = await import('child_process')
        const authParam = password ? `-a "${password}"` : ''

        execSync(
          `"${cliExe}" -p ${port} ${authParam} -n ${args.db} DEL "${args.key}" 2>/dev/null`,
          { encoding: 'utf8' }
        )

        return { ok: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`删除键失败: ${message}`)
      }
    }
  )

  // ============ MySQL IPC Handlers ============

  // MySQL 状态管理
  ipcMain.handle(
    'envhub:mysql:status',
    async (_evt, args: { mysqlVersion: string; port?: number }) => {
      const port = args.port || 3306
      const dataDir = join(mysqlDataDir(args.mysqlVersion, 'main'), 'data')
      return await getMysqlStatus(dataDir, port)
    }
  )

  // MySQL 数据库管理
  ipcMain.handle('envhub:mysql:listDatabases', async (_evt, args: { mysqlVersion: string }) => {
    const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
    const socketPath = `/tmp/mysql_main_3306.sock`

    return await listMysqlDatabases(binDir, socketPath)
  })

  ipcMain.handle(
    'envhub:mysql:getDatabasesWithMetadata',
    async (_evt, args: { mysqlVersion: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      const databases = await listMysqlDatabases(binDir, socketPath)
      const metadata = getAllMysqlDatabaseMetadata(args.mysqlVersion, 'main')

      // 合并数据库列表和元数据
      return {
        databases: databases.map((db) => {
          const meta = metadata.find((m) => m.dbName === db.dbName)
          return {
            ...db,
            note: meta?.note || '',
            createdAt: meta?.createdAt || ''
          }
        })
      }
    }
  )

  ipcMain.handle(
    'envhub:mysql:createDatabase',
    async (
      _evt,
      args: {
        mysqlVersion: string
        dbName: string
        charset?: string
        collation?: string
        note?: string
      }
    ) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await createMysqlDatabase(
        binDir,
        socketPath,
        args.dbName,
        args.charset || 'utf8mb4',
        args.collation
      )

      // 保存元数据
      addMysqlDatabaseMetadata(args.mysqlVersion, 'main', {
        dbName: args.dbName,
        charset: args.charset || 'utf8mb4',
        collation: args.collation || 'utf8mb4_general_ci',
        note: args.note || ''
      })

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:deleteDatabase',
    async (_evt, args: { mysqlVersion: string; dbName: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await dropMysqlDatabase(binDir, socketPath, args.dbName)

      // 删除元数据
      deleteMysqlDatabaseMetadata(args.mysqlVersion, 'main', args.dbName)

      return { ok: true }
    }
  )

  // MySQL 用户管理
  ipcMain.handle('envhub:mysql:listUsers', async (_evt, args: { mysqlVersion: string }) => {
    const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
    const socketPath = `/tmp/mysql_main_3306.sock`

    const users = await listMysqlUsers(binDir, socketPath)
    return users
  })

  ipcMain.handle('envhub:mysql:getUserMetadata', async (_evt, args: { mysqlVersion: string }) => {
    return getAllMysqlUserMetadata(args.mysqlVersion, 'main')
  })

  ipcMain.handle(
    'envhub:mysql:createUser',
    async (
      _evt,
      args: {
        mysqlVersion: string
        username: string
        password: string
        host?: string
        note?: string
      }
    ) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`
      const host = args.host || 'localhost'

      await createMysqlUser(binDir, socketPath, args.username, args.password, host)

      // 保存元数据
      addMysqlUserMetadata(args.mysqlVersion, 'main', {
        username: args.username,
        host,
        password: args.password,
        note: args.note || ''
      })

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:deleteUser',
    async (_evt, args: { mysqlVersion: string; username: string; host: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await dropMysqlUser(binDir, socketPath, args.username, args.host)

      // 删除元数据
      deleteMysqlUserMetadata(args.mysqlVersion, 'main', args.username, args.host)

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:changePassword',
    async (
      _evt,
      args: { mysqlVersion: string; username: string; host: string; newPassword: string }
    ) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await changeMysqlPassword(binDir, socketPath, args.username, args.host, args.newPassword)

      // 更新元数据
      updateMysqlUserPassword(args.mysqlVersion, 'main', args.username, args.host, args.newPassword)

      return { ok: true }
    }
  )

  // MySQL 权限管理
  ipcMain.handle(
    'envhub:mysql:showGrants',
    async (_evt, args: { mysqlVersion: string; username: string; host: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      return await showGrants(binDir, socketPath, args.username, args.host)
    }
  )

  ipcMain.handle(
    'envhub:mysql:grantPrivileges',
    async (
      _evt,
      args: {
        mysqlVersion: string
        username: string
        host: string
        database: string
        privileges: string[]
      }
    ) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await grantPrivileges(
        binDir,
        socketPath,
        args.username,
        args.host,
        args.database,
        args.privileges
      )

      // 保存元数据
      addGrantMetadata(args.mysqlVersion, 'main', {
        username: args.username,
        host: args.host,
        database: args.database,
        privileges: args.privileges
      })

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:revokePrivileges',
    async (
      _evt,
      args: {
        mysqlVersion: string
        username: string
        host: string
        database: string
        privileges: string[]
      }
    ) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await revokePrivileges(
        binDir,
        socketPath,
        args.username,
        args.host,
        args.database,
        args.privileges
      )

      // 删除元数据
      deleteGrantMetadata(args.mysqlVersion, 'main', args.username, args.host, args.database)

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:getUserDatabases',
    async (_evt, args: { mysqlVersion: string; username: string; host: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      return await getUserDatabases(binDir, socketPath, args.username, args.host)
    }
  )

  // MySQL 备份/导入
  ipcMain.handle('envhub:mysql:selectBackupPath', async (_evt, args: { dbName: string }) => {
    const result = await dialog.showSaveDialog({
      title: '选择备份保存位置',
      defaultPath: `${args.dbName}-${new Date().toISOString().split('T')[0]}.sql`,
      filters: [
        { name: 'SQL 备份文件', extensions: ['sql'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    return {
      canceled: result.canceled,
      filePath: result.filePath
    }
  })

  ipcMain.handle('envhub:mysql:selectRestoreFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择备份文件',
      filters: [
        { name: 'SQL 备份文件', extensions: ['sql'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0]
    }
  })

  ipcMain.handle(
    'envhub:mysql:backup',
    async (evt, args: { mysqlVersion: string; dbName: string; filePath: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await backupDatabase(binDir, socketPath, args.dbName, args.filePath, (message: string) => {
        evt.sender.send('envhub:mysql:backup:log', message)
      })

      return { ok: true }
    }
  )

  ipcMain.handle(
    'envhub:mysql:restore',
    async (evt, args: { mysqlVersion: string; dbName: string; filePath: string }) => {
      const binDir = join(toolchainRoot('mysql', args.mysqlVersion), 'bin')
      const socketPath = `/tmp/mysql_main_3306.sock`

      await restoreDatabase(binDir, socketPath, args.dbName, args.filePath, (message: string) => {
        evt.sender.send('envhub:mysql:restore:log', message)
      })

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
