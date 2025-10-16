<script setup lang="ts">
import { ref } from 'vue'
import {
  IconDelete,
  IconCloudDownload,
  IconRefresh,
  IconCodeBlock
} from '@arco-design/web-vue/es/icon'
import { Message } from '@arco-design/web-vue'
import { useToolVersion } from './composables/useToolVersion'
import InstallProgressModal from './components/InstallProgressModal.vue'

const {
  fetchingVersions,
  installingVersions,
  installProgress,
  onlineVersions,
  isInstalled,
  isCurrent,
  refreshVersions,
  useVersion,
  unsetCurrent,
  uninstall,
  installOnline,
  closeInstallProgress
} = useToolVersion('redis')

const columns = [
  { title: '版本', dataIndex: 'version', width: 150 },
  { title: '状态', slotName: 'status', width: 200 },
  { title: '操作', slotName: 'actions' }
]

const redisStatus = ref<Record<string, { running: boolean; pid?: number; port?: number }>>({})

async function checkRedisStatus(v: string): Promise<void> {
  try {
    const status = await window.electron.ipcRenderer.invoke('envhub:redis:status', {
      redisVersion: v
    })
    redisStatus.value[v] = status
  } catch (error) {
    console.error('Failed to check Redis status:', error)
  }
}

// 重写 useVersion 以支持 Redis 状态检查
async function useRedisVersion(version: string): Promise<void> {
  await useVersion(version)
  await checkRedisStatus(version)
}

// 重写 unsetCurrent 以支持 Redis 状态检查
async function unsetRedisCurrent(): Promise<void> {
  await unsetCurrent()
  // Redis 停用后刷新所有版本状态
  const versions = Object.keys(redisStatus.value)
  for (const v of versions) {
    await checkRedisStatus(v)
  }
}

// 打开 Redis 终端
async function openRedisTerminal(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:openTerminal', {
      version,
      port: 6379
    })
  } catch (error) {
    console.error('Failed to open Redis terminal:', error)
  }
}

// 重启 Redis
async function restartRedis(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:restart', {
      version
    })
    Message.success(`Redis ${version} 已重启`)
    await checkRedisStatus(version)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to restart Redis:', error)
    Message.error(`重启失败: ${message}`)
  }
}

// 重载配置
async function reloadRedisConfig(version: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:reload', {
      version
    })
    Message.success(`Redis ${version} 配置已重载`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to reload Redis config:', message)
    Message.error(message)
  }
}
</script>

<template>
  <div class="w-full">
    <div class="mb-4">
      <a-button type="outline" size="small" :loading="fetchingVersions" @click="refreshVersions()">
        <template #icon>
          <icon-refresh />
        </template>
        刷新版本列表
      </a-button>
    </div>

    <a-table
      :columns="columns"
      :data="onlineVersions"
      :pagination="{ pageSize: 20, showTotal: true }"
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
          <a-tag v-else-if="isCurrent(record.version) && isInstalled(record.version)" color="gray"
            >已停止</a-tag
          >
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
            <template #icon>
              <icon-cloud-download />
            </template>
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
            <template #icon>
              <icon-code-block />
            </template>
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
            <template #icon>
              <icon-refresh />
            </template>
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
              <template #icon>
                <icon-delete />
              </template>
              卸载
            </a-button>
          </a-popconfirm>
          <a-button
            v-if="isInstalled(record.version) && isCurrent(record.version)"
            type="text"
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
