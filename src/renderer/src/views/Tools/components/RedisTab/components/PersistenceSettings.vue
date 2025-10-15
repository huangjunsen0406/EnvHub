<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Message } from '@arco-design/web-vue'

const props = defineProps<{
  version: string
}>()

const dataDir = ref('')
const form = ref({
  aofEnabled: false,
  aofFsync: 'everysec',
  rdbRules: [
    { seconds: 900, changes: 1 },
    { seconds: 300, changes: 10 },
    { seconds: 60, changes: 10000 }
  ]
})

const loading = ref(false)

async function loadConfig(): Promise<void> {
  try {
    loading.value = true
    const config = await window.electron.ipcRenderer.invoke('envhub:redis:getConfig', {
      version: props.version
    })
    dataDir.value = config.dataDir || ''
    // TODO: 解析配置中的 AOF 和 RDB 设置
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`加载配置失败: ${message}`)
  } finally {
    loading.value = false
  }
}

async function saveConfig(): Promise<void> {
  try {
    loading.value = true

    await window.electron.ipcRenderer.invoke('envhub:redis:updateConfig', {
      version: props.version,
      config: {
        appendonly: form.value.aofEnabled ? 'yes' : 'no',
        appendfsync: form.value.aofFsync
      }
    })

    Message.success({
      content: '配置已保存，请立即重启 Redis 使其生效！',
      duration: 5000
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`保存失败: ${message}`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (props.version) {
    loadConfig()
  }
})
</script>

<template>
  <div class="w-full">
    <a-form :model="form" :style="{ maxWidth: '800px' }">
      <a-form-item label="持久化文件存储路径">
        <a-input v-model="dataDir" readonly />
        <template #extra> Redis 数据文件将保存在此目录（RDB 和 AOF 文件） </template>
      </a-form-item>

      <a-divider>AOF持久化</a-divider>

      <a-form-item label="appendonly">
        <a-select v-model="form.aofEnabled" :style="{ width: '200px' }">
          <a-option :value="false">关闭</a-option>
          <a-option :value="true">开启</a-option>
        </a-select>
      </a-form-item>

      <a-form-item label="appendfsync">
        <a-select v-model="form.aofFsync" :style="{ width: '200px' }">
          <a-option value="always">always</a-option>
          <a-option value="everysec">everysec</a-option>
          <a-option value="no">no</a-option>
        </a-select>
      </a-form-item>

      <a-form-item>
        <a-button type="primary" :loading="loading" @click="saveConfig">保存</a-button>
      </a-form-item>

      <a-divider>RDB持久化</a-divider>

      <div v-for="(rule, index) in form.rdbRules" :key="index" class="flex gap-4 mb-4">
        <a-input-number v-model="rule.seconds" :min="1" placeholder="900" :style="{ width: '150px' }" />
        <span class="self-center">秒内，插入</span>
        <a-input-number v-model="rule.changes" :min="1" placeholder="1" :style="{ width: '150px' }" />
        <span class="self-center">条数据</span>
      </div>

      <a-form-item>
        <a-button type="primary" :loading="loading" @click="saveConfig">保存</a-button>
      </a-form-item>
    </a-form>

    <a-alert type="info" class="mt-4">符合任意一个条件将会触发RDB持久化</a-alert>
  </div>
</template>
