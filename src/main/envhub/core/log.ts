import { mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { logsDir } from './paths'

export function logInfo(message: string): void {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}`
  try {
    mkdirSync(logsDir(), { recursive: true })
    appendFileSync(join(logsDir(), 'envhub.log'), line + '\n', 'utf8')
  } catch (error: unknown) {
    // Ignore write errors - log to console as fallback
    console.error('Failed to write log:', error)
  }
  // 发送到渲染进程
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('envhub:log', { message, level: 'info', timestamp })
    } catch (error: unknown) {
      // Ignore IPC send errors - window might be closing
      console.error('Failed to send log to renderer:', error)
    }
  }
}
