<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useToolsStore } from '../store/tools'
import { useLogsStore } from '../store/logs'
import PostgresTab from './Tools/PostgresTab.vue'
import RedisTab from './Tools/RedisTab/index.vue'
import MySQLTab from './Tools/MySQLTab.vue'

type Database = 'pg' | 'redis' | 'mysql'

const activeTab = ref<Database>('pg')
const toolsStore = useToolsStore()

onMounted(async () => {
  try {
    // 1. 先加载已安装列表（快速）
    await toolsStore.refreshInstalled()

    // 2. 后台并行加载所有数据库的在线版本
    const databases: Database[] = ['pg', 'redis', 'mysql']
    await Promise.all(
      databases.map((db) =>
        !toolsStore.versionsLoaded[db]
          ? toolsStore.fetchOnlineVersions(db, false).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err)
              const logsStore = useLogsStore()
              logsStore.addLog(`Failed to fetch ${db} versions: ${message}`, 'error')
            })
          : Promise.resolve()
      )
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to initialize Databases page: ${message}`, 'error')
  }
})
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <a-card :bordered="false">
      <a-tabs v-model:active-key="activeTab" size="large">
        <!-- PostgreSQL Tab -->
        <a-tab-pane key="pg" title="PostgreSQL">
          <template #icon>
            <span style="font-size: 18px">🐘</span>
          </template>
          <PostgresTab />
        </a-tab-pane>

        <!-- MySQL Tab -->
        <a-tab-pane key="mysql" title="MySQL">
          <template #icon>
            <span style="font-size: 18px">🐬</span>
          </template>
          <MySQLTab />
        </a-tab-pane>

        <!-- Redis Tab -->
        <a-tab-pane key="redis" title="Redis">
          <template #icon>
            <span style="font-size: 18px">🔴</span>
          </template>
          <RedisTab />
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>
