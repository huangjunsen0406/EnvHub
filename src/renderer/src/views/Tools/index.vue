<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useToolsStore } from '../../store/tools'
import PythonTab from './components/PythonTab.vue'
import NodeTab from './components/NodeTab.vue'
import PostgresTab from './components/PostgresTab.vue'
import JavaTab from './components/JavaTab.vue'

type Tool = 'python' | 'node' | 'pg' | 'java'

const activeTab = ref<Tool>('python')
const toolsStore = useToolsStore()

onMounted(async () => {
  try {
    // 1. 先加载已安装列表（快速）
    await toolsStore.refreshInstalled()

    // 2. 后台并行加载所有工具的在线版本
    const tools: Tool[] = ['python', 'node', 'pg', 'java']
    await Promise.all(
      tools.map((tool) =>
        !toolsStore.versionsLoaded[tool]
          ? toolsStore
              .fetchOnlineVersions(tool, false)
              .catch((err) => console.error(`Failed to fetch ${tool} versions:`, err))
          : Promise.resolve()
      )
    )
  } catch (error) {
    console.error('Failed to initialize Tools page:', error)
  }
})
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <a-card :bordered="false">
      <a-tabs v-model:active-key="activeTab" size="large">
        <!-- Python Tab -->
        <a-tab-pane key="python" title="Python">
          <template #icon>
            <span style="font-size: 18px">🐍</span>
          </template>
          <PythonTab />
        </a-tab-pane>

        <!-- Node.js Tab -->
        <a-tab-pane key="node" title="Node.js">
          <template #icon>
            <span style="font-size: 18px">📦</span>
          </template>
          <NodeTab />
        </a-tab-pane>

        <!-- PostgreSQL Tab -->
        <a-tab-pane key="pg" title="PostgreSQL">
          <template #icon>
            <span style="font-size: 18px">🐘</span>
          </template>
          <PostgresTab />
        </a-tab-pane>

        <!-- Java Tab -->
        <a-tab-pane key="java" title="Java">
          <template #icon>
            <span style="font-size: 18px">☕</span>
          </template>
          <JavaTab />
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>
