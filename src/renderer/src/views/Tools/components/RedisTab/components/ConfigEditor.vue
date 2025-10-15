<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Message } from '@arco-design/web-vue'

const props = defineProps<{
  version: string
}>()

const configContent = ref('')
const loading = ref(false)

async function loadConfig(): Promise<void> {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:redis:getConfig', {
      version: props.version
    })
    configContent.value = result.content || ''
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
    await window.electron.ipcRenderer.invoke('envhub:redis:saveConfig', {
      version: props.version,
      content: configContent.value
    })
    Message.success('配置已保存')
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
    <div class="mb-4">
      <a-alert type="info">
        提示: Ctrl+F 搜索关键字，Ctrl+G 查找下一个，Ctrl+S 保存，Ctrl+Shift+R 查找替换!
      </a-alert>
    </div>

    <a-textarea
      v-model="configContent"
      :auto-size="{ minRows: 20, maxRows: 40 }"
      placeholder="Redis 配置文件内容"
      :style="{ fontFamily: 'monospace', fontSize: '13px' }"
    />

    <div class="mt-4">
      <a-button type="primary" :loading="loading" @click="saveConfig">保存</a-button>
    </div>

    <div class="mt-4">
      <a-alert type="warning">
        此处为redis主配置文件,若您不了解配置规则,请勿随意修改。
      </a-alert>
      <a-alert type="error" class="mt-2">
        警告：请勿开启Redis外网访问权限，未限制访问IP的情况下极大概率导致服务器被入侵。
      </a-alert>
    </div>
  </div>
</template>
