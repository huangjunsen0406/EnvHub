import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface LogEntry {
  timestamp: string
  message: string
  level: 'info' | 'warn' | 'error'
}

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<LogEntry[]>([])

  function addLog(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const timestamp = new Date().toLocaleTimeString()
    logs.value.push({
      timestamp,
      message,
      level
    })
  }

  function clearLogs() {
    logs.value = []
  }

  // 初始化时监听主进程的日志
  function initLogListener() {
    window.electron.ipcRenderer.on(
      'envhub:log',
      (_event, data: { message: string; level?: string }) => {
        addLog(data.message, (data.level as any) || 'info')
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
