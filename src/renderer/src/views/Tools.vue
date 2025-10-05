<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { Message } from '@arco-design/web-vue'
import {
  IconDelete,
  IconCloudDownload
} from '@arco-design/web-vue/es/icon'
import { useToolsStore } from '../store/tools'

type Tool = 'python' | 'node' | 'pg'

const activeTab = ref<Tool>('python')
const toolsStore = useToolsStore()

const state = reactive({
  cluster: 'main',
  port: 5432,
  loading: false,
  fetchingVersions: false,
  installingVersions: {} as Record<string, boolean>,
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

async function refreshInstalled(): Promise<void> {
  await toolsStore.refreshInstalled()
}

function versionsOf(tool: Tool): Array<{ version: string; [key: string]: unknown }> {
  return onlineVersions.value[tool] || []
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

async function installOnline(tool: Tool, version: string, url: string): Promise<void> {
  const versionKey = `${tool}-${version}`
  try {
    state.installingVersions[versionKey] = true
    showInstallProgress(tool, version)

    updateInstallProgress(`正在下载 ${tool} ${version}...`)

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
        await toolsStore.loadDownloadedInstallers()
        updateInstallProgress('安装包下载完成！', 'success')
        Message.success(`Python ${version} 安装包已下载`)
      } else {
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
    await toolsStore.loadDownloadedInstallers()
    Message.success('安装包已删除')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`删除失败：${message}`)
  }
}

onMounted(async () => {
  try {
    await refreshInstalled()
    toolsStore.loadDownloadedInstallers()

    if (!toolsStore.versionsLoaded.python) {
      await fetchOnlineVersions().catch((err) => {
        console.error('Failed to fetch online versions:', err)
      })
    }
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
                <a-tag v-if="isInstalled('python', record.version)" color="green">已安装</a-tag>
                <a-tag
                  v-else-if="isPythonInstallerDownloaded(record.version)"
                  color="orange"
                >
                  已下载
                </a-tag>
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('python', record.version)" color="blue">当前版本</a-tag>
                <a-tag v-if="record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
                <!-- 未下载：显示下载按钮 -->
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
                <!-- 已下载：显示安装和删除按钮 -->
                <template v-else>
                  <a-button type="primary" size="small" @click="openPythonInstaller(record.version)">
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
                <a-tag v-if="isInstalled('node', record.version)" color="green">已安装</a-tag>
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('node', record.version)" color="blue">当前版本</a-tag>
                <a-tag v-if="record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
                <a-button
                  v-if="!isInstalled('node', record.version)"
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
                <a-button
                  v-if="isInstalled('node', record.version) && !isCurrent('node', record.version)"
                  type="outline"
                  size="small"
                  @click="useVer('node', record.version)"
                >
                  启用
                </a-button>
                <a-button
                  v-if="isInstalled('node', record.version) && isCurrent('node', record.version)"
                  type="outline"
                  size="small"
                  @click="unsetCurrent('node')"
                >
                  停用
                </a-button>
                <a-popconfirm
                  content="确定要卸载此版本吗？"
                  @ok="uninstall('node', record.version)"
                >
                  <a-button
                    v-if="isInstalled('node', record.version) && !isCurrent('node', record.version)"
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

          <a-table
            :columns="columns"
            :data="versionsOf('pg')"
            :pagination="{ pageSize: 20, showTotal: true }"
          >
            <template #status="{ record }">
              <a-space>
                <a-tag v-if="isInstalled('pg', record.version)" color="green">已安装</a-tag>
                <a-tag v-else color="gray">未安装</a-tag>
                <a-tag v-if="isCurrent('pg', record.version)" color="blue">当前版本</a-tag>
                <a-tag v-if="state.pgStatus[record.version]?.running" color="arcoblue">
                  运行中 PID:{{ state.pgStatus[record.version].pid }} 端口:{{
                    state.pgStatus[record.version].port
                  }}
                </a-tag>
                <a-tag v-else-if="isInstalled('pg', record.version)" color="gray">已停止</a-tag>
                <a-tag v-if="record.date" color="arcoblue">
                  {{ new Date(record.date).toLocaleDateString() }}
                </a-tag>
              </a-space>
            </template>
            <template #actions="{ record }">
              <a-space>
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
                <a-button
                  v-if="state.pgStatus[record.version]?.running"
                  type="outline"
                  status="warning"
                  size="small"
                  :loading="state.loading"
                  @click="stopPg(record.version)"
                >
                  停止
                </a-button>
                <a-button
                  v-if="state.pgStatus[record.version]?.running"
                  type="outline"
                  size="small"
                  :loading="state.loading"
                  @click="restartPg(record.version)"
                >
                  重启
                </a-button>
                <a-button
                  v-if="isInstalled('pg', record.version)"
                  type="text"
                  size="small"
                  @click="checkPgStatus(record.version)"
                >
                  刷新状态
                </a-button>
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
