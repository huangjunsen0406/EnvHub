<script setup lang="ts">
import { ref, reactive } from 'vue'
import { IconDelete, IconCloudDownload, IconRefresh } from '@arco-design/web-vue/es/icon'
import { useToolVersion } from '../composables/useToolVersion'

const {
  fetchingVersions,
  installingVersions,
  onlineVersions,
  isInstalled,
  isCurrent,
  refreshVersions,
  useVersion,
  unsetCurrent,
  uninstall,
  installOnline
} = useToolVersion('pg')

const columns = [
  { title: '版本', dataIndex: 'version', width: 150 },
  { title: '状态', slotName: 'status', width: 200 },
  { title: '操作', slotName: 'actions' }
]

const pgStatus = ref<
  Record<string, { running: boolean; pid?: number; port?: number; dataDir?: string }>
>({})

const state = reactive({
  cluster: 'main'
})

async function checkPgStatus(v: string): Promise<void> {
  try {
    const pgMajor = v.split('.')[0]
    const dataDir = `~/.envhub/pg/${pgMajor}/${state.cluster}`
    const status = await window.electron.ipcRenderer.invoke('envhub:pg:status', {
      pgVersion: v,
      dataDir
    })
    pgStatus.value[v] = status
  } catch (error) {
    console.error('Failed to check PG status:', error)
  }
}

// 重写 useVersion 以支持 PostgreSQL 状态检查
async function usePgVersion(version: string): Promise<void> {
  await useVersion(version)
  await checkPgStatus(version)
}

// 重写 unsetCurrent 以支持 PostgreSQL 状态检查
async function unsetPgCurrent(): Promise<void> {
  await unsetCurrent()
  // PostgreSQL 停用后刷新所有版本状态
  const versions = Object.keys(pgStatus.value)
  for (const v of versions) {
    await checkPgStatus(v)
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
          <a-tag v-if="pgStatus[record.version]?.running" color="arcoblue">
            运行中 PID:{{ pgStatus[record.version].pid }} 端口:{{ pgStatus[record.version].port }}
          </a-tag>
          <a-tag v-else-if="isInstalled(record.version)" color="gray">已停止</a-tag>
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
            :loading="installingVersions[`pg-${record.version}`]"
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
            @click="usePgVersion(record.version)"
          >
            启用
          </a-button>
          <a-button
            v-if="isInstalled(record.version) && isCurrent(record.version)"
            type="outline"
            size="small"
            @click="unsetPgCurrent()"
          >
            停用
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
            v-if="isInstalled(record.version)"
            type="text"
            size="small"
            @click="checkPgStatus(record.version)"
          >
            刷新状态
          </a-button>
        </a-space>
      </template>
    </a-table>
  </div>
</template>
