<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconRefresh } from '@arco-design/web-vue/es/icon'

const props = defineProps<{
  version: string
}>()

const loading = ref(false)
const stats = ref<
  Array<{
    key: string
    value: string
    description: string
  }>
>([])

const columns = [
  { title: '字段', dataIndex: 'key', width: 250 },
  { title: '当前值', dataIndex: 'value', width: 200 },
  { title: '说明', dataIndex: 'description' }
]

async function loadStatus(): Promise<void> {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:redis:info', {
      version: props.version
    })

    // 解析 INFO 输出并格式化
    const parsed = parseRedisInfo(result.info || '')
    stats.value = parsed
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`加载状态失败: ${message}`)
  } finally {
    loading.value = false
  }
}

function parseRedisInfo(info: string) {
  const lines = info.split('\n')
  const result: Array<{ key: string; value: string; description: string }> = []

  // 关键指标及其说明
  const keyDescriptions: Record<string, string> = {
    uptime_in_days: '已运行天数',
    tcp_port: '当前监听端口',
    connected_clients: '连接的客户端数量',
    used_memory_rss: 'Redis当前占用的系统内存总量',
    used_memory: 'Redis历史分配内存的峰值',
    mem_fragmentation_ratio: '内存碎片比率',
    total_connections_received: '运行以来连接过的客户端的总数量',
    total_commands_processed: '运行以来执行过的命令的总数量',
    instantaneous_ops_per_sec: '服务器每秒钟执行的命令数量',
    keyspace_hits: '查找数据库键成功的次数',
    keyspace_misses: '查找数据库键失败的次数',
    latest_fork_usec: '最近一次 fork() 操作耗费的微秒数'
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const [key, value] = trimmed.split(':')
    if (key && value && keyDescriptions[key]) {
      result.push({
        key,
        value: value.trim(),
        description: keyDescriptions[key]
      })
    }
  }

  // 计算命中率
  const hits = result.find((s) => s.key === 'keyspace_hits')
  const misses = result.find((s) => s.key === 'keyspace_misses')
  if (hits && misses) {
    const hitRate = (parseInt(hits.value) / (parseInt(hits.value) + parseInt(misses.value))) * 100
    result.push({
      key: 'hit_rate',
      value: hitRate.toFixed(2) + '%',
      description: '查找数据库键命中率'
    })
  }

  return result
}

onMounted(() => {
  if (props.version) {
    loadStatus()
  }
})
</script>

<template>
  <div class="w-full">
    <div class="mb-4">
      <a-button type="outline" size="small" :loading="loading" @click="loadStatus">
        <template #icon>
          <icon-refresh />
        </template>
        刷新
      </a-button>
    </div>

    <a-table :columns="columns" :data="stats" :pagination="false" :bordered="true" />
  </div>
</template>
