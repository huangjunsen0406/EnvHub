<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useToolsStore } from '../store/tools'

const toolsStore = useToolsStore()

const languages = ref([
  { name: 'Python', current: '-', installed: 0, icon: '🐍', key: 'python' },
  { name: 'Node.js', current: '-', installed: 0, icon: '📦', key: 'node' },
  { name: 'Java', current: '-', installed: 0, icon: '☕', key: 'java' }
])

const databases = ref([
  { name: 'PostgreSQL', current: '-', installed: 0, icon: '🐘', key: 'pg' },
  { name: 'Redis', current: '-', installed: 0, icon: '🔴', key: 'redis' }
])

onMounted(async () => {
  // 加载已下载的 Python 安装包
  toolsStore.loadDownloadedInstallers()

  // 获取已安装工具
  const installed = await window.electron.ipcRenderer.invoke('envhub:installed:list')

  // 更新编程语言状态
  languages.value[0].installed = installed.python?.length || 0
  languages.value[0].current = installed.current?.python || '-'
  languages.value[1].installed = installed.node?.length || 0
  languages.value[1].current = installed.current?.node || '-'
  languages.value[2].installed = installed.java?.length || 0
  languages.value[2].current = installed.current?.java || '-'

  // 更新数据库状态
  databases.value[0].installed = installed.pg?.length || 0
  databases.value[0].current = installed.current?.pg || '-'
  databases.value[1].installed = installed.redis?.length || 0
  databases.value[1].current = installed.current?.redis || '-'
})
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <!-- 编程语言组 -->
    <a-row :gutter="16">
      <a-col :span="24">
        <a-card title="编程语言" :bordered="false" class="mb-4">
          <template #extra>
            <a-tag color="blue">{{ languages.length }} 个工具</a-tag>
          </template>
          <a-row :gutter="16">
            <a-col v-for="lang in languages" :key="lang.key" :xs="24" :sm="12" :md="8" :lg="8">
              <a-card :bordered="false" hoverable class="mb-4 bg-gray-50">
                <div class="p-2">
                  <div class="flex items-center gap-3 mb-3">
                    <span class="text-[40px]">{{ lang.icon }}</span>
                    <span class="text-xl font-semibold">{{ lang.name }}</span>
                  </div>
                  <a-divider class="my-3" />
                  <a-space direction="vertical" :size="12" class="w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-gray-500 text-sm font-medium">当前版本：</span>
                      <a-tag v-if="lang.current !== '-'" color="green" size="large">{{
                        lang.current
                      }}</a-tag>
                      <span v-else class="text-gray-400">未设置</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-gray-500 text-sm font-medium">已安装：</span>
                      <a-tag color="blue">{{ lang.installed }} 个版本</a-tag>
                    </div>
                  </a-space>
                </div>
              </a-card>
            </a-col>
          </a-row>
        </a-card>
      </a-col>
    </a-row>

    <!-- 数据库组 -->
    <a-row :gutter="16">
      <a-col :span="24">
        <a-card title="数据库" :bordered="false">
          <template #extra>
            <a-tag color="purple">{{ databases.length }} 个工具</a-tag>
          </template>
          <a-row :gutter="16">
            <a-col v-for="db in databases" :key="db.key" :xs="24" :sm="12" :md="12" :lg="12">
              <a-card :bordered="false" hoverable class="mb-4 bg-gray-50">
                <div class="p-2">
                  <div class="flex items-center gap-3 mb-3">
                    <span class="text-[40px]">{{ db.icon }}</span>
                    <span class="text-xl font-semibold">{{ db.name }}</span>
                  </div>
                  <a-divider class="my-3" />
                  <a-space direction="vertical" :size="12" class="w-full">
                    <div class="flex items-center gap-2">
                      <span class="text-gray-500 text-sm font-medium">当前版本：</span>
                      <a-tag v-if="db.current !== '-'" color="green" size="large">{{
                        db.current
                      }}</a-tag>
                      <span v-else class="text-gray-400">未设置</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-gray-500 text-sm font-medium">已安装：</span>
                      <a-tag color="blue">{{ db.installed }} 个版本</a-tag>
                    </div>
                  </a-space>
                </div>
              </a-card>
            </a-col>
          </a-row>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>
