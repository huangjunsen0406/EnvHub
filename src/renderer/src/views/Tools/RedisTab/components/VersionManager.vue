<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { useToolVersion } from '../../composables/useToolVersion'
import { useLogsStore } from '../../../../store/logs'
import InstallProgressModal from '../../components/InstallProgressModal.vue'

const {
  installingVersions,
  installProgress,
  onlineVersions,
  isInstalled,
  isCurrent,
  useVersion,
  unsetCurrent,
  uninstall,
  installOnline,
  closeInstallProgress
} = useToolVersion('redis')

const columns = [
  { title: '版本', dataIndex: 'version', width: 150, align: 'center' },
  { title: '状态', slotName: 'status', width: 200, align: 'center' },
  { title: '操作', slotName: 'actions', align: 'center' }
]

const redisStatus = ref<Record<string, { running: boolean; pid?: number; port?: number }>>({})

async function checkRedisStatus(v: string): Promise<void> {
  try {
    const status = await window.electron.ipcRenderer.invoke('envhub:redis:status', {
      redisVersion: v
    })
    redisStatus.value[v] = status
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to check Redis status: ${message}`, 'error')
  }
}

async function useRedisVersion(version: string): Promise<void> {
  await useVersion(version)
  await checkRedisStatus(version)
}

async function unsetRedisCurrent(): Promise<void> {
  await unsetCurrent()
  const versions = Object.keys(redisStatus.value)
  for (const v of versions) {
    await checkRedisStatus(v)
  }
}

async function openRedisTerminal(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:openTerminal', {
      version
      // 不传 port，让后端从配置文件读取实际端口
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to open Redis terminal: ${message}`, 'error')
  }
}

async function restartRedis(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:restart', {
      version
    })
    Message.success(`Redis ${version} 已重启`)
    await checkRedisStatus(version)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to restart Redis: ${message}`, 'error')
    Message.error(`重启失败: ${message}`)
  }
}

async function reloadRedisConfig(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:reload', {
      version
    })
    Message.success(`Redis ${version} 配置已重载`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to reload Redis config: ${message}`, 'error')
    Message.error(message)
  }
}

// 组件挂载时检查当前版本的状态
onMounted(async () => {
  // 等待 onlineVersions 加载完成
  await new Promise((resolve) => setTimeout(resolve, 100))

  // 检查当前版本的运行状态
  const currentVersion = onlineVersions.value.find((v) => isCurrent(v.version))
  if (currentVersion) {
    await checkRedisStatus(currentVersion.version)
  }
})

// 监听 onlineVersions 变化，自动检查当前版本状态
watch(
  onlineVersions,
  async (versions) => {
    const currentVersion = versions.find((v) => isCurrent(v.version))
    if (currentVersion) {
      await checkRedisStatus(currentVersion.version)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="w-full">
    <a-table
      :columns="columns"
      :data="onlineVersions"
      :pagination="{ pageSize: 10, showTotal: true }"
    >
      <template #status="{ record }">
        <a-space>
          <a-tag v-if="isInstalled(record.version)" color="green">已安装</a-tag>
          <a-tag v-else color="gray">未安装</a-tag>
          <a-tag v-if="isCurrent(record.version)" color="blue">当前版本</a-tag>
          <a-tag
            v-if="isCurrent(record.version) && redisStatus[record.version]?.running"
            color="arcoblue"
          >
            运行中 PID:{{ redisStatus[record.version].pid }} 端口:{{
              redisStatus[record.version].port
            }}
          </a-tag>
          <a-tag v-else-if="isCurrent(record.version) && isInstalled(record.version)" color="gray">
            已停止
          </a-tag>
          <a-tag v-if="record.date" color="arcoblue">
            {{ new Date(record.date).toLocaleDateString() }}
          </a-tag>
        </a-space>
      </template>
      <template #actions="{ record }">
        <a-space>
          <a-button
            v-if="!isInstalled(record.version)"
            type="primary"
            size="small"
            :loading="installingVersions[`redis-${record.version}`]"
            @click="installOnline(record.version, record.url)"
          >
            安装
          </a-button>
          <a-button
            v-if="isInstalled(record.version) && !isCurrent(record.version)"
            type="outline"
            size="small"
            @click="useRedisVersion(record.version)"
          >
            启用
          </a-button>
          <a-button
            v-if="isInstalled(record.version) && isCurrent(record.version)"
            type="outline"
            size="small"
            @click="unsetRedisCurrent()"
          >
            停用
          </a-button>
          <a-button
            v-if="
              isInstalled(record.version) &&
              isCurrent(record.version) &&
              redisStatus[record.version]?.running
            "
            type="outline"
            status="success"
            size="small"
            @click="openRedisTerminal(record.version)"
          >
            终端
          </a-button>
          <a-button
            v-if="
              isInstalled(record.version) &&
              isCurrent(record.version) &&
              redisStatus[record.version]?.running
            "
            type="outline"
            size="small"
            @click="restartRedis(record.version)"
          >
            重启
          </a-button>
          <a-button
            v-if="
              isInstalled(record.version) &&
              isCurrent(record.version) &&
              redisStatus[record.version]?.running
            "
            type="outline"
            size="small"
            @click="reloadRedisConfig(record.version)"
          >
            重载配置
          </a-button>
          <a-popconfirm content="确定要卸载此版本吗？" @ok="uninstall(record.version)">
            <a-button
              v-if="isInstalled(record.version) && !isCurrent(record.version)"
              type="outline"
              status="danger"
              size="small"
            >
              卸载
            </a-button>
          </a-popconfirm>
          <a-button
            v-if="isInstalled(record.version) && isCurrent(record.version)"
            type="outline"
            size="small"
            @click="checkRedisStatus(record.version)"
          >
            刷新状态
          </a-button>
        </a-space>
      </template>
    </a-table>

    <InstallProgressModal :progress="installProgress" @close="closeInstallProgress" />
  </div>
</template>
