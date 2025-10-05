<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { Message } from '@arco-design/web-vue'
import {
  IconDownload,
  IconDelete,
  IconSettings,
  IconFolder,
  IconCloudDownload,
  IconRefresh
} from '@arco-design/web-vue/es/icon'
import { useToolsStore } from '../store/tools'

type Tool = 'python' | 'node' | 'pg'

const activeTab = ref<Tool>('python')
const toolsStore = useToolsStore()

const state = reactive({
  installMode: 'online' as 'online' | 'offline', // 安装模式
  bundleDir: '',
  manifest: null,
  wheelsRel: 'wheels',
  pnpmTgzRel: 'npm/pnpm.tgz',
  cluster: 'main',
  port: 5432,
  loading: false,
  fetchingVersions: false,
  installingVersions: {} as Record<string, boolean>, // 记录正在安装的版本
  pgStatus: {} as Record<
    string,
    { running: boolean; pid?: number; port?: number; dataDir?: string }
  >,
  installProgress: {
    visible: false,
    tool: '',
    version: '',
    status: 'info' as 'info' | 'success' | 'error',
    message: '',
    logs: [] as string[],
    percent: 0,
    speed: '',
    eta: ''
  }
})

// 使用 computed 从 store 获取数据
const onlineVersions = computed(() => toolsStore.onlineVersions)
const installed = computed(() => toolsStore.installed)
const downloadedInstallers = computed(() => toolsStore.downloadedInstallers)

function showInstallProgress(tool: string, version: string): void {
  state.installProgress = {
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
  state.installProgress.message = message
  state.installProgress.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`)
  if (status) {
    state.installProgress.status = status
  }
}

function hideInstallProgress(): void {
  setTimeout(() => {
    state.installProgress.visible = false
  }, 2000)
}

const columns = [
  { title: '版本', dataIndex: 'version', width: 150 },
  { title: '状态', slotName: 'status', width: 200 },
  { title: '操作', slotName: 'actions' }
]

async function loadManifest(): Promise<void> {
  if (!state.bundleDir) {
    Message.warning('请先选择离线包目录')
    return
  }
  try {
    state.loading = true
    state.manifest = await window.electron.ipcRenderer.invoke('envhub:manifest:load', {
      bundleDir: state.bundleDir
    })
    await refreshInstalled()
    Message.success('清单加载成功')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`加载失败：${message}`)
  } finally {
    state.loading = false
  }
}

async function refreshInstalled(): Promise<void> {
  await toolsStore.refreshInstalled()
}

function versionsOf(tool: Tool): Array<{ version: string; [key: string]: unknown }> {
  if (state.installMode === 'online') {
    // 在线模式：返回在线版本列表
    const versions = onlineVersions.value[tool] || []
    console.log(`versionsOf(${tool}) in online mode:`, versions.length, 'versions')
    return versions
  } else {
    // 离线模式：返回 manifest 版本
    if (!state.manifest || !state.manifest[tool]) {
      console.log(`versionsOf(${tool}) in offline mode: no manifest`)
      return []
    }
    const versions = Object.keys(state.manifest[tool]).map((version) => ({ version }))
    console.log(`versionsOf(${tool}) in offline mode:`, versions.length, 'versions')
    return versions
  }
}

function isInstalled(tool: Tool, v: string): boolean {
  return (installed.value[tool] || []).some((x: { version: string }) => x.version === v)
}

function isCurrent(tool: Tool, v: string): boolean {
  return installed.value.current?.[tool] === v
}

function isPythonInstallerDownloaded(version: string): boolean {
  return !!downloadedInstallers.value?.python?.[version]
}

async function install(tool: Tool, v: string): Promise<void> {
  if (!state.bundleDir) {
    Message.warning('请先设置离线包目录')
    return
  }
  try {
    state.loading = true
    showInstallProgress(tool, v)

    updateInstallProgress(`开始安装 ${tool} ${v}`)
    updateInstallProgress('验证离线包清单...')

    const result = await window.electron.ipcRenderer.invoke('envhub:install:one', {
      bundleDir: state.bundleDir,
      tool,
      version: v
    })

    if (tool === 'pg') {
      updateInstallProgress('安装完成！PostgreSQL 已自动初始化并启动', 'success')
      Message.success(`${tool} ${v} 安装完成，已自动初始化并启动`)
      if (result.dataDir) {
        await checkPgStatus(v)
      }
    } else {
      updateInstallProgress('安装完成！', 'success')
      Message.success(`${tool} ${v} 安装完成`)
    }
    await refreshInstalled()
    hideInstallProgress()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    updateInstallProgress(`安装失败：${message}`, 'error')
    Message.error(`安装失败：${message}`)
  } finally {
    state.loading = false
  }
}

async function useVer(tool: Tool, v: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:use', { tool, version: v })
    Message.success(`已切换到 ${tool} ${v}`)
    await refreshInstalled()
    if (tool === 'pg') {
      await checkPgStatus(v)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`切换失败：${message}`)
  }
}

async function unsetCurrent(tool: Tool): Promise<void> {
  try {
    // 如果是 PostgreSQL，先停止服务
    if (tool === 'pg') {
      const currentVersion = installed.value.current?.pg
      if (currentVersion && state.pgStatus[currentVersion]?.running) {
        await stopPg(currentVersion)
      }
    }

    await window.electron.ipcRenderer.invoke('envhub:use', { tool, version: '' })
    Message.success(`已取消 ${tool} 的当前版本设置`)
    await refreshInstalled()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`取消失败：${message}`)
  }
}

async function uninstall(tool: Tool, v: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:uninstall', { tool, version: v })
    Message.success(`${tool} ${v} 已卸载`)
    await refreshInstalled()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`卸载失败：${message}`)
  }
}

async function checkPgStatus(v: string): Promise<void> {
  try {
    const pgMajor = v.split('.')[0]
    const dataDir = `~/.envhub/pg/${pgMajor}/${state.cluster}`
    const status = await window.electron.ipcRenderer.invoke('envhub:pg:status', {
      pgVersion: v,
      dataDir
    })
    state.pgStatus[v] = status
  } catch (error) {
    console.error('Failed to check PG status:', error)
  }
}

async function stopPg(v: string): Promise<void> {
  try {
    state.loading = true
    const pgMajor = v.split('.')[0]
    const dataDir = state.pgStatus[v]?.dataDir || `~/.envhub/pg/${pgMajor}/${state.cluster}`
    await window.electron.ipcRenderer.invoke('envhub:pg:stop', {
      pgVersion: v,
      dataDir
    })
    Message.success(`PostgreSQL ${v} 已停止`)
    await checkPgStatus(v)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`停止失败：${message}`)
  } finally {
    state.loading = false
  }
}

async function restartPg(v: string): Promise<void> {
  try {
    state.loading = true
    const pgMajor = v.split('.')[0]
    const dataDir = state.pgStatus[v]?.dataDir || `~/.envhub/pg/${pgMajor}/${state.cluster}`
    await window.electron.ipcRenderer.invoke('envhub:pg:restart', {
      pgVersion: v,
      dataDir
    })
    Message.success(`PostgreSQL ${v} 已重启`)
    await checkPgStatus(v)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`重启失败：${message}`)
  } finally {
    state.loading = false
  }
}

async function installPgVector(v: string): Promise<void> {
  try {
    state.loading = true
    const pgMajor = v.split('.')[0]
    await window.electron.ipcRenderer.invoke('envhub:pg:installVector', {
      bundleDir: state.bundleDir,
      pgVersion: v,
      pgMajor
    })
    Message.success(`已为 PostgreSQL ${v} 安装 pgvector`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`安装失败：${message}`)
  } finally {
    state.loading = false
  }
}

async function selectDirectory(): Promise<void> {
  try {
    const path = await window.electron.ipcRenderer.invoke('envhub:selectDirectory')
    if (path) {
      state.bundleDir = path
      localStorage.setItem('envhub:bundleDir', path)
      Message.success('目录已选择，请点击"加载清单"')
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`选择失败：${message}`)
  }
}

async function fetchOnlineVersions(tool?: Tool): Promise<void> {
  try {
    state.fetchingVersions = true
    await toolsStore.fetchOnlineVersions(tool)
    Message.success('在线版本列表已更新')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`获取版本列表失败：${message}`)
  } finally {
    state.fetchingVersions = false
  }
}

function onInstallModeChange(val: string): void {
  state.installMode = val as 'online' | 'offline'
  localStorage.setItem('envhub:installMode', val)
}

async function installOnline(tool: Tool, version: string, url: string): Promise<void> {
  const versionKey = `${tool}-${version}`
  try {
    state.installingVersions[versionKey] = true
    showInstallProgress(tool, version)

    updateInstallProgress(`正在下载 ${tool} ${version}...`)

    // 监听下载进度
    const progressHandler = (
      _event: unknown,
      progress: { tool: string; version: string; percent: number; speed: string; eta: string }
    ): void => {
      if (progress.tool === tool && progress.version === version) {
        state.installProgress.percent = progress.percent
        state.installProgress.speed = progress.speed
        state.installProgress.eta = progress.eta
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

      if (tool === 'python') {
        // Python 下载完成，重新扫描下载目录
        await toolsStore.loadDownloadedInstallers()
        updateInstallProgress('安装包下载完成！', 'success')
        Message.success(`Python ${version} 安装包已下载`)
      } else {
        // Node.js 和 PostgreSQL 自动安装
        updateInstallProgress('下载并安装完成！', 'success')
        Message.success(`${tool} ${version} 安装完成`)
        await refreshInstalled()
      }
      hideInstallProgress()
    } finally {
      window.electron.ipcRenderer.removeAllListeners('envhub:download:progress')
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    updateInstallProgress(`安装失败：${message}`, 'error')
    Message.error(`安装失败：${message}`)
  } finally {
    delete state.installingVersions[versionKey]
  }
}

async function openPythonInstaller(version: string): Promise<void> {
  const installerPath = downloadedInstallers.value?.python?.[version]
  if (!installerPath) {
    Message.error('安装包不存在')
    return
  }
  try {
    await window.electron.ipcRenderer.invoke('envhub:python:openInstaller', { path: installerPath })
    Message.success('已打开安装器，请按照向导完成安装')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`打开安装器失败：${message}`)
  }
}

async function deletePythonInstaller(version: string): Promise<void> {
  const installerPath = downloadedInstallers.value?.python?.[version]
  if (!installerPath) {
    Message.error('安装包不存在')
    return
  }
  try {
    await window.electron.ipcRenderer.invoke('envhub:python:deleteInstaller', {
      path: installerPath
    })
    // 重新扫描下载目录
    await toolsStore.loadDownloadedInstallers()
    Message.success('安装包已删除')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`删除失败：${message}`)
  }
}

onMounted(async () => {
  console.log('Tools component mounted')
  try {
    // 加载已安装工具和已下载的安装包
    await refreshInstalled()
    toolsStore.loadDownloadedInstallers()

    // 从本地存储加载配置
    const savedDir = localStorage.getItem('envhub:bundleDir')
    if (savedDir) {
      state.bundleDir = savedDir
    }
    const savedMode = localStorage.getItem('envhub:installMode')
    if (savedMode) {
      state.installMode = savedMode as 'online' | 'offline'
    }

    // 如果是在线模式，自动加载版本列表（如果还没加载过）
    if (state.installMode === 'online' && !toolsStore.versionsLoaded.python) {
      console.log('Fetching online versions...')
      await fetchOnlineVersions().catch((err) => {
        console.error('Failed to fetch online versions:', err)
      })
    }
    console.log('Tools component initialization complete')
  } catch (error) {
    console.error('Failed to initialize Tools page:', error)
  }
})

onUnmounted(() => {
  console.log('Tools component unmounted')
})
</script>

<template>
  <div class="tools-page">
    <a-card title="安装模式" :bordered="false" style="margin-bottom: 16px">
      <a-space direction="vertical" :size="16" style="width: 100%">
        <!-- 模式切换 -->
        <a-radio-group
          v-model="state.installMode"
          type="button"
          size="large"
          @change="onInstallModeChange"
        >
          <a-radio value="online">
            <icon-cloud-download style="margin-right: 4px" />
            在线安装
          </a-radio>
          <a-radio value="offline">
            <icon-folder style="margin-right: 4px" />
            离线安装
          </a-radio>
        </a-radio-group>

        <!-- 在线模式配置 -->
        <div v-if="state.installMode === 'online'">
          <a-alert type="info" closable>
            在线模式将从官方镜像源下载工具，国内使用淘宝/清华镜像加速
          </a-alert>
          <a-button
            type="primary"
            size="large"
            :loading="state.fetchingVersions"
            style="margin-top: 12px"
            @click="fetchOnlineVersions()"
          >
            <template #icon>
              <icon-refresh />
            </template>
            刷新版本列表
          </a-button>
        </div>

        <!-- 离线模式配置 -->
        <div v-if="state.installMode === 'offline'">
          <a-input-group>
            <a-input
              v-model="state.bundleDir"
              placeholder="请选择离线包目录（包含 manifest.json）"
              size="large"
              readonly
              style="width: calc(100% - 180px)"
            >
              <template #prepend> 离线包目录 </template>
            </a-input>
            <a-button size="large" @click="selectDirectory">
              <template #icon>
                <icon-folder />
              </template>
              浏览
            </a-button>
          </a-input-group>
          <a-button
            type="primary"
            size="large"
            :loading="state.loading"
            style="margin-top: 12px"
            @click="loadManifest"
          >
            <template #icon>
              <icon-download />
            </template>
            加载清单
          </a-button>
        </div>
      </a-space>
    </a-card>

    <a-card :bordered="false">
      <a-tabs v-model:active-key="activeTab" size="large">
        <!-- Python Tab -->
        <a-tab-pane key="python" title="Python">
          <template #icon>
            <span style="font-size: 18px">🐍</span>
          </template>

          <a-table
            :columns="columns"
            :data="versionsOf('python')"
            :pagination="{ pageSize: 20, showTotal: true }"
          >
            <template #status="{ record }">
              <a-space>
                <a-tag v-if="isInstalled('python', record.version || record)" color="green"
                  >已安装</a-tag
                >
                <a-tag
                  v-else-if="
                    state.installMode === 'online' && isPythonInstallerDownloaded(record.version)
                  "
                  color="orange"
                  >已下载</a-tag
                >
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('python', record.version || record)" color="blue"
                  >当前版本</a-tag
                >
                <a-tag v-if="state.installMode === 'online' && record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
                <!-- 在线模式 -->
                <template v-if="state.installMode === 'online'">
                  <!-- 未下载安装包：显示下载按钮 -->
                  <a-button
                    v-if="!isPythonInstallerDownloaded(record.version)"
                    type="primary"
                    size="small"
                    :loading="state.installingVersions[`python-${record.version}`]"
                    @click="installOnline('python', record.version, record.url)"
                  >
                    <template #icon>
                      <icon-cloud-download />
                    </template>
                    下载安装包
                  </a-button>
                  <!-- 已下载安装包：显示安装和删除按钮 -->
                  <template v-else>
                    <a-button
                      type="primary"
                      size="small"
                      @click="openPythonInstaller(record.version)"
                    >
                      安装
                    </a-button>
                    <a-popconfirm
                      content="确定要删除此安装包吗？"
                      @ok="deletePythonInstaller(record.version)"
                    >
                      <a-button type="outline" status="danger" size="small">
                        <template #icon>
                          <icon-delete />
                        </template>
                        删除
                      </a-button>
                    </a-popconfirm>
                  </template>
                </template>

                <!-- 离线模式 -->
                <template v-else>
                  <a-button
                    v-if="!isInstalled('python', record.version || record)"
                    type="primary"
                    size="small"
                    :loading="state.loading"
                    @click="install('python', record.version || record)"
                  >
                    <template #icon>
                      <icon-download />
                    </template>
                    安装
                  </a-button>
                  <a-button
                    v-if="
                      isInstalled('python', record.version || record) &&
                      !isCurrent('python', record.version || record)
                    "
                    type="outline"
                    size="small"
                    @click="useVer('python', record.version || record)"
                  >
                    启用
                  </a-button>
                  <a-button
                    v-if="
                      isInstalled('python', record.version || record) &&
                      isCurrent('python', record.version || record)
                    "
                    type="outline"
                    size="small"
                    @click="unsetCurrent('python')"
                  >
                    停用
                  </a-button>
                  <a-popconfirm
                    content="确定要卸载此版本吗？"
                    @ok="uninstall('python', record.version || record)"
                  >
                    <a-button
                      v-if="
                        isInstalled('python', record.version || record) &&
                        !isCurrent('python', record.version || record)
                      "
                      type="outline"
                      status="danger"
                      size="small"
                    >
                      <template #icon>
                        <icon-delete />
                      </template>
                      卸载
                    </a-button>
                  </a-popconfirm>
                </template>
              </a-space>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- Node.js Tab -->
        <a-tab-pane key="node" title="Node.js">
          <template #icon>
            <span style="font-size: 18px">📦</span>
          </template>

          <a-table
            :columns="columns"
            :data="versionsOf('node')"
            :pagination="{ pageSize: 20, showTotal: true }"
          >
            <template #status="{ record }">
              <a-space>
                <a-tag v-if="isInstalled('node', record.version || record)" color="green"
                  >已安装</a-tag
                >
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('node', record.version || record)" color="blue"
                  >当前版本</a-tag
                >
                <a-tag v-if="state.installMode === 'online' && record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
                <!-- 在线安装按钮 -->
                <a-button
                  v-if="state.installMode === 'online' && !isInstalled('node', record.version)"
                  type="primary"
                  size="small"
                  :loading="state.installingVersions[`node-${record.version}`]"
                  @click="installOnline('node', record.version, record.url)"
                >
                  <template #icon>
                    <icon-cloud-download />
                  </template>
                  安装
                </a-button>
                <!-- 离线安装按钮 -->
                <a-button
                  v-if="
                    state.installMode === 'offline' &&
                    !isInstalled('node', record.version || record)
                  "
                  type="primary"
                  size="small"
                  :loading="state.loading"
                  @click="install('node', record.version || record)"
                >
                  <template #icon>
                    <icon-download />
                  </template>
                  安装
                </a-button>
                <a-button
                  v-if="
                    isInstalled('node', record.version || record) &&
                    !isCurrent('node', record.version || record)
                  "
                  type="outline"
                  size="small"
                  @click="useVer('node', record.version || record)"
                >
                  启用
                </a-button>
                <a-button
                  v-if="
                    isInstalled('node', record.version || record) &&
                    isCurrent('node', record.version || record)
                  "
                  type="outline"
                  size="small"
                  @click="unsetCurrent('node')"
                >
                  停用
                </a-button>
                <a-popconfirm
                  content="确定要卸载此版本吗？"
                  @ok="uninstall('node', record.version || record)"
                >
                  <a-button
                    v-if="
                      isInstalled('node', record.version || record) &&
                      !isCurrent('node', record.version || record)
                    "
                    type="outline"
                    status="danger"
                    size="small"
                  >
                    <template #icon>
                      <icon-delete />
                    </template>
                    卸载
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- PostgreSQL Tab -->
        <a-tab-pane key="pg" title="PostgreSQL">
          <template #icon>
            <span style="font-size: 18px">🐘</span>
          </template>

          <!-- 配置信息 -->
          <a-alert
            v-if="state.installMode === 'offline'"
            type="info"
            closable
            style="margin-bottom: 16px"
          >
            <template #icon>
              <icon-settings />
            </template>
            PostgreSQL 配置：
            <a-space style="margin-left: 12px">
              <span>集群名</span>
              <a-input v-model="state.cluster" size="small" style="width: 120px" />
              <span>端口</span>
              <a-input-number
                v-model="state.port"
                size="small"
                :min="5432"
                :max="65535"
                style="width: 100px"
              />
            </a-space>
          </a-alert>

          <a-table
            :columns="columns"
            :data="versionsOf('pg')"
            :pagination="{ pageSize: 20, showTotal: true }"
          >
            <template #status="{ record }">
              <a-space>
                <a-tag v-if="isInstalled('pg', record.version || record)" color="green"
                  >已安装</a-tag
                >
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('pg', record.version || record)" color="blue"
                  >当前版本</a-tag
                >
                <a-tag v-if="state.pgStatus[record.version || record]?.running" color="arcoblue">
                  运行中 PID:{{ state.pgStatus[record.version || record].pid }} 端口:{{
                    state.pgStatus[record.version || record].port
                  }}
                </a-tag>
                <a-tag v-else-if="isInstalled('pg', record.version || record)" color="gray"
                  >已停止</a-tag
                >
                <a-tag v-if="state.installMode === 'online' && record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
                <!-- 在线模式 -->
                <template v-if="state.installMode === 'online'">
                  <!-- 在线安装按钮（下载+安装一键完成） -->
                  <a-button
                    v-if="!isInstalled('pg', record.version)"
                    type="primary"
                    size="small"
                    :loading="state.installingVersions[`pg-${record.version}`]"
                    @click="installOnline('pg', record.version, record.url)"
                  >
                    <template #icon>
                      <icon-cloud-download />
                    </template>
                    安装
                  </a-button>
                  <!-- 已安装：显示启用/停用/卸载按钮 -->
                  <a-button
                    v-if="isInstalled('pg', record.version) && !isCurrent('pg', record.version)"
                    type="outline"
                    size="small"
                    @click="useVer('pg', record.version)"
                  >
                    启用
                  </a-button>
                  <a-button
                    v-if="isInstalled('pg', record.version) && isCurrent('pg', record.version)"
                    type="outline"
                    size="small"
                    @click="unsetCurrent('pg')"
                  >
                    停用
                  </a-button>
                  <a-popconfirm
                    content="确定要卸载此版本吗？"
                    @ok="uninstall('pg', record.version)"
                  >
                    <a-button
                      v-if="isInstalled('pg', record.version) && !isCurrent('pg', record.version)"
                      type="outline"
                      status="danger"
                      size="small"
                    >
                      <template #icon>
                        <icon-delete />
                      </template>
                      卸载
                    </a-button>
                  </a-popconfirm>
                </template>

                <!-- 离线模式 -->
                <template v-else>
                  <!-- 离线安装按钮（一键安装） -->
                  <a-button
                    v-if="!isInstalled('pg', record.version || record)"
                    type="primary"
                    size="small"
                    :loading="state.loading"
                    @click="install('pg', record.version || record)"
                  >
                    <template #icon>
                      <icon-download />
                    </template>
                    一键安装
                  </a-button>
                  <a-button
                    v-if="
                      isInstalled('pg', record.version || record) &&
                      !isCurrent('pg', record.version || record)
                    "
                    type="outline"
                    size="small"
                    @click="useVer('pg', record.version || record)"
                  >
                    启用
                  </a-button>
                  <a-button
                    v-if="
                      isInstalled('pg', record.version || record) &&
                      isCurrent('pg', record.version || record)
                    "
                    type="outline"
                    size="small"
                    @click="unsetCurrent('pg')"
                  >
                    停用
                  </a-button>
                  <a-popconfirm
                    content="确定要卸载此版本吗？"
                    @ok="uninstall('pg', record.version || record)"
                  >
                    <a-button
                      v-if="
                        isInstalled('pg', record.version || record) &&
                        !isCurrent('pg', record.version || record)
                      "
                      type="outline"
                      status="danger"
                      size="small"
                    >
                      <template #icon>
                        <icon-delete />
                      </template>
                      卸载
                    </a-button>
                  </a-popconfirm>
                  <a-button
                    v-if="state.pgStatus[record.version || record]?.running"
                    type="outline"
                    status="warning"
                    size="small"
                    :loading="state.loading"
                    @click="stopPg(record.version || record)"
                  >
                    停止
                  </a-button>
                  <a-button
                    v-if="state.pgStatus[record.version || record]?.running"
                    type="outline"
                    size="small"
                    :loading="state.loading"
                    @click="restartPg(record.version || record)"
                  >
                    重启
                  </a-button>
                  <a-button
                    v-if="isInstalled('pg', record.version || record)"
                    type="text"
                    size="small"
                    @click="checkPgStatus(record.version || record)"
                  >
                    刷新状态
                  </a-button>
                </template>
              </a-space>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 安装进度 Modal -->
    <a-modal
      v-model:visible="state.installProgress.visible"
      :title="`安装 ${state.installProgress.tool} ${state.installProgress.version}`"
      :footer="false"
      :closable="state.installProgress.status !== 'info'"
      :mask-closable="false"
      width="600px"
    >
      <div class="install-modal-content">
        <a-alert :type="state.installProgress.status" :closable="false">
          {{ state.installProgress.message }}
        </a-alert>

        <div v-if="state.installProgress.logs.length > 0" class="install-logs">
          <div class="log-title">安装日志：</div>
          <div class="log-content">
            <div v-for="(log, index) in state.installProgress.logs" :key="index" class="log-line">
              {{ log }}
            </div>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.tools-page {
  max-width: 1400px;
  margin: 0 auto;
}

.install-modal-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 400px;
}

.install-logs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: #1d2129;
  flex-shrink: 0;
}

.log-content {
  background: #f7f8fa;
  border-radius: 4px;
  padding: 12px;
  height: 300px;
  overflow-y: auto;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-line {
  color: #4e5969;
  margin-bottom: 4px;
}
</style>
