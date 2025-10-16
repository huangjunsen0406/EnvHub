import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useLogsStore } from './logs'

export interface OnlineVersion {
  version: string
  url: string
  date?: string
  lts?: boolean
  distribution?: string
}

export interface InstalledVersion {
  version: string
  [key: string]: unknown
}

export interface InstalledInfo {
  python: InstalledVersion[]
  node: InstalledVersion[]
  pg: InstalledVersion[]
  java: InstalledVersion[]
  redis: InstalledVersion[]
  current: Record<string, string>
}

export const useToolsStore = defineStore('tools', () => {
  // 在线版本列表
  const onlineVersions = ref<{
    python: OnlineVersion[]
    node: OnlineVersion[]
    pg: OnlineVersion[]
    java: OnlineVersion[]
    redis: OnlineVersion[]
  }>({
    python: [],
    node: [],
    pg: [],
    java: [],
    redis: []
  })

  // 已安装工具信息
  const installed = ref<InstalledInfo>({
    python: [],
    node: [],
    pg: [],
    java: [],
    redis: [],
    current: {}
  })

  // 已下载的安装包（Python 和 PostgreSQL）
  const downloadedInstallers = ref<{
    python: Record<string, string>
    pg: Record<string, string>
  }>({
    python: {},
    pg: {}
  })

  // 版本列表是否已加载
  const versionsLoaded = ref({
    python: false,
    node: false,
    pg: false,
    java: false,
    redis: false
  })

  // 获取在线版本列表
  async function fetchOnlineVersions(
    tool?: 'python' | 'node' | 'pg' | 'java' | 'redis',
    forceRefresh = false
  ): Promise<void> {
    const tools = tool ? [tool] : (['python', 'node', 'pg', 'java', 'redis'] as const)

    // 并行请求所有需要加载的工具
    const promises = tools
      .filter((t) => tool || forceRefresh || !versionsLoaded.value[t]) // 如果已加载过且不是强制刷新，跳过
      .map(async (t) => {
        try {
          const versions = await window.electron.ipcRenderer.invoke('envhub:online:fetchVersions', {
            tool: t,
            forceRefresh
          })
          onlineVersions.value[t] = versions || []
          versionsLoaded.value[t] = true
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          const logsStore = useLogsStore()
          logsStore.addLog(`Failed to fetch ${t} versions: ${message}`, 'error')
          onlineVersions.value[t] = []
          versionsLoaded.value[t] = false
        }
      })

    // 等待所有请求完成（即使部分失败也不影响其他）
    await Promise.allSettled(promises)
  }

  // 刷新已安装工具列表
  async function refreshInstalled(): Promise<void> {
    try {
      const res = await window.electron.ipcRenderer.invoke('envhub:installed:list')
      installed.value = res
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const logsStore = useLogsStore()
      logsStore.addLog(`Failed to refresh installed tools: ${message}`, 'error')
      // 返回空数据而不是抛出错误
      installed.value = {
        python: [],
        node: [],
        pg: [],
        java: [],
        redis: [],
        current: {}
      }
    }
  }

  // 加载已下载的安装包信息（从下载目录扫描）
  async function loadDownloadedInstallers(): Promise<void> {
    try {
      const scanned = await window.electron.ipcRenderer.invoke('envhub:scanDownloadedInstallers')
      downloadedInstallers.value = scanned || { python: {}, pg: {} }
      const logsStore = useLogsStore()
      logsStore.addLog(
        `Scanned ${Object.keys(downloadedInstallers.value.python).length} Python installers, ${Object.keys(downloadedInstallers.value.pg).length} PostgreSQL installers`,
        'info'
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const logsStore = useLogsStore()
      logsStore.addLog(`Failed to scan downloaded installers: ${message}`, 'error')
      downloadedInstallers.value = { python: {}, pg: {} }
    }
  }

  return {
    onlineVersions,
    installed,
    downloadedInstallers,
    versionsLoaded,
    fetchOnlineVersions,
    refreshInstalled,
    loadDownloadedInstallers
  }
})
