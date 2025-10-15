<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Message } from '@arco-design/web-vue'

const props = defineProps<{
  version: string
}>()

const form = ref({
  bind: '127.0.0.1',
  port: 6379,
  timeout: 0,
  maxclients: 10000,
  databases: 16,
  requirepass: '',
  maxmemory: 0
})

const loading = ref(false)

async function loadConfig(): Promise<void> {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:redis:getConfig', {
      version: props.version
    })

    // 解析配置文件
    const content = result.content || ''
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const [key, ...valueParts] = trimmed.split(/\s+/)
      const value = valueParts.join(' ')

      switch (key) {
        case 'bind':
          form.value.bind = value
          break
        case 'port':
          form.value.port = parseInt(value) || 6379
          break
        case 'timeout':
          form.value.timeout = parseInt(value) || 0
          break
        case 'maxclients':
          form.value.maxclients = parseInt(value) || 10000
          break
        case 'databases':
          form.value.databases = parseInt(value) || 16
          break
        case 'requirepass':
          form.value.requirepass = value
          break
        case 'maxmemory':
          // 解析 maxmemory，可能是 "100mb" 或 "0"
          const memMatch = value.match(/^(\d+)(mb|gb|kb)?$/i)
          if (memMatch) {
            let memValue = parseInt(memMatch[1])
            const unit = (memMatch[2] || '').toLowerCase()
            if (unit === 'gb') memValue *= 1024
            else if (unit === 'kb') memValue /= 1024
            form.value.maxmemory = memValue
          } else {
            form.value.maxmemory = 0
          }
          break
      }
    }
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

    // 构建配置对象 - 只传递简单的键值对
    const config: Record<string, string | number> = {
      bind: form.value.bind,
      port: form.value.port,
      timeout: form.value.timeout,
      maxclients: form.value.maxclients,
      databases: form.value.databases,
      maxmemory: form.value.maxmemory > 0 ? `${form.value.maxmemory}mb` : '0'
    }

    // 密码配置：空字符串表示移除密码
    const removeKeys: string[] = []
    if (form.value.requirepass) {
      config.requirepass = form.value.requirepass
    } else {
      // 如果密码为空，需要移除 requirepass 配置项
      removeKeys.push('requirepass')
    }

    await window.electron.ipcRenderer.invoke('envhub:redis:updateConfig', {
      version: props.version,
      config,
      removeKeys
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
    <a-form :model="form" :style="{ maxWidth: '600px' }">
      <a-form-item label="bind" tooltip="绑定IP（修改绑定IP可能会存在安全隐患）">
        <a-input v-model="form.bind" placeholder="127.0.0.1" />
      </a-form-item>

      <a-form-item label="port" tooltip="绑定端口">
        <a-input-number v-model="form.port" :min="1" :max="65535" placeholder="6379" />
      </a-form-item>

      <a-form-item label="timeout" tooltip="空闲连接超时时间，0表示不断开">
        <a-input-number v-model="form.timeout" :min="0" placeholder="0" />
      </a-form-item>

      <a-form-item label="maxclients" tooltip="最大连接数">
        <a-input-number v-model="form.maxclients" :min="1" placeholder="10000" />
      </a-form-item>

      <a-form-item label="databases" tooltip="数据库数量">
        <a-input-number v-model="form.databases" :min="1" :max="256" placeholder="16" />
      </a-form-item>

      <a-form-item label="requirepass" tooltip="Redis密码，留空代表没有设置密码">
        <a-input-password v-model="form.requirepass" placeholder="留空代表没有设置密码" />
      </a-form-item>

      <a-form-item label="maxmemory" tooltip="MB，最大使用内存，0表示不限制">
        <a-input-number v-model="form.maxmemory" :min="0" placeholder="0" />
      </a-form-item>

      <a-form-item>
        <a-button type="primary" :loading="loading" @click="saveConfig">保存</a-button>
      </a-form-item>
    </a-form>

    <a-alert type="warning" style="margin-top: 16px">
      修改配置后需要重启redis生效，若您的数据需要持久化请先执行save操作。
    </a-alert>

    <a-alert type="error" style="margin-top: 16px">
      警告：请勿开启Redis外网访问权限，未限制访问IP的情况下极大概率导致服务器被入侵。
    </a-alert>
  </div>
</template>
