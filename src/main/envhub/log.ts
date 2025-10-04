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
  } catch {}
  // 发送到渲染进程
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('envhub:log', { message, level: 'info', timestamp })
    } catch {}
  }
}
