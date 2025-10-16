import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface LogEntry {
  timestamp: string
  message: string
  level: 'info' | 'warn' | 'error'
}

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<LogEntry[]>([])

  function addLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = new Date().toLocaleTimeString()
    logs.value.push({
      timestamp,
      message,
      level
    })
  }

  function clearLogs(): void {
    logs.value = []
  }

  // 初始化时监听主进程的日志
  function initLogListener(): void {
    window.electron.ipcRenderer.on(
      'envhub:log',
      (_event: unknown, data: { message: string; level?: 'info' | 'warn' | 'error' }) => {
        addLog(data.message, data.level ?? 'info')
      }
    )
  }

  return {
    logs,
    addLog,
    clearLogs,
    initLogListener
  }
})
