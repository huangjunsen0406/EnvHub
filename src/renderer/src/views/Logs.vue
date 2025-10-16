<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { IconDelete, IconDownload, IconRefresh } from '@arco-design/web-vue/es/icon'
import { useLogsStore } from '../store/logs'

const logsStore = useLogsStore()

const autoScroll = ref(true)
const filter = ref('')

function scrollToBottom(): void {
  const container = document.querySelector('.log-content')
  if (container) {
    container.scrollTop = container.scrollHeight
  }
}

function clearLogs(): void {
  logsStore.clearLogs()
}

function exportLogs(): void {
  const content = logsStore.logs.map((log) => `[${log.timestamp}] ${log.message}`).join('\n')
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `envhub-logs-${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

const filteredLogs = computed(() => {
  if (!filter.value) return logsStore.logs
  return logsStore.logs.filter((log) =>
    log.message.toLowerCase().includes(filter.value.toLowerCase())
  )
})

// 自动滚动
watch(
  () => logsStore.logs.length,
  () => {
    if (autoScroll.value) {
      setTimeout(scrollToBottom, 100)
    }
  }
)
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <a-card :bordered="false">
      <template #title>
        <a-space>
          <span>实时日志</span>
          <a-tag color="green"> {{ logsStore.logs.length }} 条记录 </a-tag>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-input v-model="filter" placeholder="过滤日志..." allow-clear class="w-[200px]">
            <template #prefix>
              <icon-search />
            </template>
          </a-input>
          <a-checkbox v-model="autoScroll"> 自动滚动 </a-checkbox>
          <a-button type="outline" size="small" @click="scrollToBottom">
            <template #icon>
              <icon-refresh />
            </template>
          </a-button>
          <a-button type="outline" size="small" @click="exportLogs">
            <template #icon>
              <icon-download />
            </template>
            导出
          </a-button>
          <a-popconfirm content="确定要清空所有日志吗？" @ok="clearLogs">
            <a-button type="outline" status="danger" size="small">
              <template #icon>
                <icon-delete />
              </template>
              清空
            </a-button>
          </a-popconfirm>
        </a-space>
      </template>

      <div class="min-h-[500px] max-h-[calc(100vh-280px)]">
        <div
          v-if="filteredLogs.length === 0"
          class="flex items-center justify-center min-h-[500px]"
        >
          <a-empty description="暂无日志" />
        </div>
        <div
          v-else
          class="bg-[#1d1d1d] text-[#d4d4d4] p-4 rounded font-mono text-[13px] leading-relaxed overflow-y-auto max-h-[calc(100vh-280px)]"
        >
          <div
            v-for="(log, index) in filteredLogs"
            :key="index"
            class="mb-1 break-all hover:bg-white/5"
          >
            [{{ log.timestamp }}] {{ log.message }}
          </div>
        </div>
      </div>
    </a-card>
  </div>
</template>
