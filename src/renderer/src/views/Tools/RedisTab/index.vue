<script setup lang="ts">
import { ref, computed } from 'vue'
import { IconRefresh } from '@arco-design/web-vue/es/icon'
import { useToolVersion } from '../composables/useToolVersion'
import VersionManager from './components/VersionManager.vue'
import PerformanceSettings from './components/PerformanceSettings.vue'
import ConfigEditor from './components/ConfigEditor.vue'
import LoadStatus from './components/LoadStatus.vue'
import PersistenceSettings from './components/PersistenceSettings.vue'
import DataBrowser from './components/DataBrowser.vue'

const { fetchingVersions, refreshVersions, isCurrent, onlineVersions } = useToolVersion('redis')

const activeTab = ref<'versions' | 'performance' | 'config' | 'status' | 'persistence' | 'data'>(
  'versions'
)

// 获取当前启用的 Redis 版本
const currentVersion = computed(() => {
  const current = onlineVersions.value.find((v) => isCurrent(v.version))
  return current?.version || ''
})
</script>

<template>
  <div class="w-full">
    <!-- Tab 切换和操作按钮 -->
    <div class="mb-4 flex gap-2">
      <a-button
        :type="activeTab === 'versions' ? 'primary' : 'outline'"
        size="small"
        @click="activeTab = 'versions'"
      >
        版本管理
      </a-button>
      <a-button
        :type="activeTab === 'data' ? 'primary' : 'outline'"
        size="small"
        :disabled="!currentVersion"
        @click="activeTab = 'data'"
      >
        数据浏览
      </a-button>
      <a-button
        :type="activeTab === 'performance' ? 'primary' : 'outline'"
        size="small"
        :disabled="!currentVersion"
        @click="activeTab = 'performance'"
      >
        性能调整
      </a-button>
      <a-button
        :type="activeTab === 'config' ? 'primary' : 'outline'"
        size="small"
        :disabled="!currentVersion"
        @click="activeTab = 'config'"
      >
        配置文件
      </a-button>
      <a-button
        :type="activeTab === 'status' ? 'primary' : 'outline'"
        size="small"
        :disabled="!currentVersion"
        @click="activeTab = 'status'"
      >
        负载状态
      </a-button>
      <a-button
        :type="activeTab === 'persistence' ? 'primary' : 'outline'"
        size="small"
        :disabled="!currentVersion"
        @click="activeTab = 'persistence'"
      >
        持久化设置
      </a-button>
      <a-button type="outline" size="small" :loading="fetchingVersions" @click="refreshVersions()">
        <template #icon>
          <icon-refresh />
        </template>
        刷新版本列表
      </a-button>
    </div>

    <!-- 版本管理 -->
    <VersionManager v-if="activeTab === 'versions'" />

    <!-- 数据浏览 -->
    <DataBrowser v-if="activeTab === 'data'" :version="currentVersion" />

    <!-- 性能调整 -->
    <PerformanceSettings v-if="activeTab === 'performance'" :version="currentVersion" />

    <!-- 配置文件 -->
    <ConfigEditor v-if="activeTab === 'config'" :version="currentVersion" />

    <!-- 负载状态 -->
    <LoadStatus v-if="activeTab === 'status'" :version="currentVersion" />

    <!-- 持久化设置 -->
    <PersistenceSettings v-if="activeTab === 'persistence'" :version="currentVersion" />
  </div>
</template>
