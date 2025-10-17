import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useToolsStore, type OnlineVersion, type InstalledVersion } from '../../../store/tools'

export type Tool = 'python' | 'node' | 'pg' | 'java' | 'redis'

export interface InstallProgress {
  visible: boolean
  tool: string
  version: string
  status: 'info' | 'success' | 'error'
  message: string
  logs: string[]
  percent: number
  speed: string
  eta: string
}

export interface UseToolVersionReturn {
  fetchingVersions: Ref<boolean>
  installingVersions: Ref<Record<string, boolean>>
  installProgress: Ref<InstallProgress>
  onlineVersions: ComputedRef<OnlineVersion[]>
  installed: ComputedRef<InstalledVersion[]>
  currentVersion: ComputedRef<string | undefined>
  isInstalled: (version: string) => boolean
  isCurrent: (version: string) => boolean
  fetchVersions: (forceRefresh?: boolean, silent?: boolean) => Promise<void>
  refreshVersions: () => Promise<void>
  useVersion: (version: string) => Promise<void>
  unsetCurrent: () => Promise<void>
  uninstall: (version: string) => Promise<void>
  installOnline: (version: string, url: string) => Promise<void>
  closeInstallProgress: () => void
}

export function useToolVersion(tool: Tool): UseToolVersionReturn {
  const toolsStore = useToolsStore()
  const fetchingVersions = ref(false)
  const installingVersions = ref<Record<string, boolean>>({})

  // 防抖标志，防止快速点击时多次调用
  let isUsing = false
  let isUnsetting = false

  const installProgress = ref<InstallProgress>({
    visible: false,
    tool: '',
    version: '',
    status: 'info',
    message: '',
    logs: [],
    percent: 0,
    speed: '',
    eta: ''
  })

  const onlineVersions = computed(() => toolsStore.onlineVersions[tool] || [])
  const installed = computed(() => toolsStore.installed[tool] || [])
  const currentVersion = computed(() => toolsStore.installed.current?.[tool])

  function isInstalled(version: string): boolean {
    return installed.value.some((x) => x.version === version)
  }

  function isCurrent(version: string): boolean {
    return currentVersion.value === version
  }

  function showInstallProgress(version: string): void {
    installProgress.value = {
      visible: true,
      tool,
      version,
      status: 'info',
      message: '正在安装...',
      logs: [],
      percent: 0,
      speed: '',
      eta: ''
    }
  }

  function updateInstallProgress(message: string, status?: 'info' | 'success' | 'error'): void {
    installProgress.value.message = message
    installProgress.value.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`)
    if (status) {
      installProgress.value.status = status
    }
  }

  function hideInstallProgress(): void {
    installProgress.value.visible = false
  }

  function closeInstallProgress(): void {
    installProgress.value.visible = false
  }

  async function fetchVersions(forceRefresh = false, silent = false): Promise<void> {
    try {
      fetchingVersions.value = true
      await toolsStore.fetchOnlineVersions(tool, forceRefresh)
      if (!silent) {
        if (forceRefresh) {
          Message.success('版本列表已刷新')
        } else {
          Message.success('在线版本列表已更新')
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      Message.error(`获取版本列表失败：${message}`)
    } finally {
      fetchingVersions.value = false
    }
  }

  async function refreshVersions(): Promise<void> {
    await fetchVersions(true)
  }

  async function useVersion(version: string): Promise<void> {
    // 防止快速重复点击
    if (isUsing) {
      Message.warning('操作进行中，请稍候...')
      return
    }

    try {
      isUsing = true
      await window.electron.ipcRenderer.invoke('envhub:use', { tool, version })
      Message.success(`已切换到 ${tool} ${version}`)
      await toolsStore.refreshInstalled()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      Message.error(`切换失败：${message}`)
    } finally {
      isUsing = false
    }
  }

  async function unsetCurrent(): Promise<void> {
    // 防止快速重复点击
    if (isUnsetting) {
      Message.warning('操作进行中，请稍候...')
      return
    }

    try {
      isUnsetting = true
      await window.electron.ipcRenderer.invoke('envhub:use', { tool, version: '' })
      Message.success(`已取消 ${tool} 的当前版本设置`)
      await toolsStore.refreshInstalled()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      Message.error(`取消失败：${message}`)
    } finally {
      isUnsetting = false
    }
  }

  async function uninstall(version: string): Promise<void> {
    try {
      await window.electron.ipcRenderer.invoke('envhub:uninstall', { tool, version })
      Message.success(`${tool} ${version} 已卸载`)
      await toolsStore.refreshInstalled()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      Message.error(`卸载失败：${message}`)
    }
  }

  async function installOnline(version: string, url: string): Promise<void> {
    const versionKey = `${tool}-${version}`
    try {
      installingVersions.value[versionKey] = true
      showInstallProgress(version)

      updateInstallProgress(`正在下载 ${tool} ${version}...`)

      const progressHandler = (
        _event: unknown,
        progress: { tool: string; version: string; percent: number; speed: string; eta: string }
      ): void => {
        if (progress.tool === tool && progress.version === version) {
          installProgress.value.percent = progress.percent
          installProgress.value.speed = progress.speed
          installProgress.value.eta = progress.eta
          updateInstallProgress(
            `下载中... ${progress.percent.toFixed(2)}% (${progress.speed}, 剩余 ${progress.eta})`
          )
        }
      }

      window.electron.ipcRenderer.on('envhub:download:progress', progressHandler)

      try {
        await window.electron.ipcRenderer.invoke('envhub:online:install', {
          tool,
          version,
          url
        })

        updateInstallProgress('下载并安装完成！', 'success')
        Message.success(`${tool} ${version} 安装完成`)
        await toolsStore.refreshInstalled()
        // 2 秒后自动关闭
        setTimeout(() => {
          hideInstallProgress()
        }, 2000)
      } finally {
        window.electron.ipcRenderer.removeAllListeners('envhub:download:progress')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误'
      updateInstallProgress(`安装失败：${message}`, 'error')
      Message.error(`安装失败：${message}`)
    } finally {
      delete installingVersions.value[versionKey]
    }
  }

  return {
    fetchingVersions,
    installingVersions,
    installProgress,
    onlineVersions,
    installed,
    currentVersion,
    isInstalled,
    isCurrent,
    fetchVersions,
    refreshVersions,
    useVersion,
    unsetCurrent,
    uninstall,
    installOnline,
    closeInstallProgress
  }
}
