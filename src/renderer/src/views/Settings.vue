<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconFolder, IconCheck, IconClose } from '@arco-design/web-vue/es/icon'

const state = reactive({
  bundleDir: '',
  shimsPath: '~/.envhub/shims',
  pathConfigured: false,
  loading: false
})

async function checkPathStatus() {
  try {
    state.pathConfigured = await window.electron.ipcRenderer.invoke('envhub:path:check')
  } catch (error) {
    console.error('Failed to check PATH status:', error)
  }
}

onMounted(async () => {
  // 从本地存储加载
  const savedDir = localStorage.getItem('envhub:bundleDir')
  if (savedDir) {
    state.bundleDir = savedDir
  }
  // 检查 PATH 状态
  await checkPathStatus()
})

async function selectDirectory() {
  try {
    const path = await window.electron.ipcRenderer.invoke('envhub:selectDirectory')
    if (path) {
      state.bundleDir = path
      // 保存到本地存储
      localStorage.setItem('envhub:bundleDir', path)
      Message.success('目录已选择')
    }
  } catch (error: any) {
    Message.error(`选择失败：${error.message}`)
  }
}

async function addToPath() {
  try {
    state.loading = true
    const result = await window.electron.ipcRenderer.invoke('envhub:path:add')
    Message.success(result)
    state.pathConfigured = true
  } catch (error: any) {
    Message.error(`配置失败：${error.message}`)
  } finally {
    state.loading = false
  }
}

async function removeFromPath() {
  try {
    state.loading = true
    const result = await window.electron.ipcRenderer.invoke('envhub:path:remove')
    Message.success(result)
    state.pathConfigured = false
  } catch (error: any) {
    Message.error(`移除失败：${error.message}`)
  } finally {
    state.loading = false
  }
}
</script>

<template>
  <div class="settings-page">
    <a-card title="离线包设置" :bordered="false" style="margin-bottom: 16px">
      <a-form :model="state" layout="vertical">
        <a-form-item label="离线包目录" tooltip="选择包含 manifest.json 的离线包目录">
          <a-input-group>
            <a-input
              v-model="state.bundleDir"
              placeholder="请选择离线包目录"
              readonly
              style="width: calc(100% - 100px)"
            />
            <a-button type="primary" @click="selectDirectory">
              <template #icon>
                <icon-folder />
              </template>
              浏览
            </a-button>
          </a-input-group>
        </a-form-item>
      </a-form>
    </a-card>

    <a-card title="PATH 环境变量" :bordered="false" style="margin-bottom: 16px">
      <a-alert type="info" style="margin-bottom: 16px" closable>
        将 {{ state.shimsPath }} 添加到系统 PATH，以便在终端中直接使用 python、node、psql 等命令。
      </a-alert>

      <a-space direction="vertical" :size="16" style="width: 100%">
        <a-descriptions bordered :column="1">
          <a-descriptions-item label="Shims 路径">
            <a-tag>{{ state.shimsPath }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="配置状态">
            <a-tag v-if="state.pathConfigured" color="green">
              <template #icon>
                <icon-check />
              </template>
              已配置
            </a-tag>
            <a-tag v-else color="gray">
              <template #icon>
                <icon-close />
              </template>
              未配置
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <a-space>
          <a-button
            v-if="!state.pathConfigured"
            type="primary"
            size="large"
            :loading="state.loading"
            @click="addToPath"
          >
            <template #icon>
              <icon-check />
            </template>
            添加到 PATH
          </a-button>
          <a-popconfirm v-else content="确定要从 PATH 中移除吗？" @ok="removeFromPath">
            <a-button type="outline" status="danger" size="large" :loading="state.loading">
              <template #icon>
                <icon-close />
              </template>
              从 PATH 移除
            </a-button>
          </a-popconfirm>
        </a-space>
      </a-space>
    </a-card>

    <a-card title="关于" :bordered="false">
      <a-descriptions :column="2" bordered>
        <a-descriptions-item label="应用名称">EnvHub</a-descriptions-item>
        <a-descriptions-item label="版本">1.0.0</a-descriptions-item>
        <a-descriptions-item label="描述" :span="2">
          本地开发环境管理器，支持 Python、Node.js、PostgreSQL 的多版本离线安装与管理
        </a-descriptions-item>
        <a-descriptions-item label="技术栈" :span="2">
          Electron + Vue 3 + TypeScript + Arco Design
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 900px;
  margin: 0 auto;
}
</style>
