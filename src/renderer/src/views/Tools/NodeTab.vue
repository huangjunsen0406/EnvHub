<script setup lang="ts">
import { ref } from 'vue'
import { IconDelete, IconCloudDownload, IconRefresh } from '@arco-design/web-vue/es/icon'
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
} = useToolVersion('node')

const columns = [
  { title: '版本', dataIndex: 'version', width: 150 },
  { title: '状态', slotName: 'status', width: 200 },
  { title: '操作', slotName: 'actions' }
]

// 操作状态追踪 - 按版本追踪而不是全局状态
const versionLoading = ref<Record<string, boolean>>({})

// 获取指定版本的加载状态
function isVersionLoading(version: string): boolean {
  return versionLoading.value[version] || false
}

// 设置指定版本的加载状态
function setVersionLoading(version: string, loading: boolean): void {
  versionLoading.value[version] = loading
}

// 重写 useVersion 以支持加载状态
async function useNodeVersion(version: string): Promise<void> {
  if (isVersionLoading(version)) return
  setVersionLoading(version, true)
  try {
    await useVersion(version)
  } finally {
    setVersionLoading(version, false)
  }
}

// 重写 unsetCurrent 以支持加载状态
async function unsetNodeCurrent(): Promise<void> {
  const currentVersion = onlineVersions.value.find((v) => isCurrent(v.version))?.version
  if (!currentVersion) return
  if (isVersionLoading(currentVersion)) return
  setVersionLoading(currentVersion, true)
  try {
    await unsetCurrent()
  } finally {
    setVersionLoading(currentVersion, false)
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
            :loading="installingVersions[`node-${record.version}`]"
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
            :loading="isVersionLoading(record.version)"
            :disabled="isVersionLoading(record.version)"
            @click="useNodeVersion(record.version)"
          >
            启用
          </a-button>
          <a-button
            v-if="isInstalled(record.version) && isCurrent(record.version)"
            type="outline"
            size="small"
            :loading="isVersionLoading(record.version)"
            :disabled="isVersionLoading(record.version)"
            @click="unsetNodeCurrent()"
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
        </a-space>
      </template>
    </a-table>

    <InstallProgressModal :progress="installProgress" @close="closeInstallProgress" />
  </div>
</template>
