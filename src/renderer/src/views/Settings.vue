<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { IconCheck, IconClockCircle } from '@arco-design/web-vue/es/icon'
import { useLogsStore } from '../store/logs'

const systemInfo = ref({
  platform: '',
  arch: '',
  shimsPath: ''
})

const pathStatus = ref({
  configured: false,
  path: ''
})

onMounted(async () => {
  // 获取系统信息
  const platform = await window.electron.ipcRenderer.invoke('envhub:detectPlatform')
  systemInfo.value = {
    platform: platform.os === 'mac' ? 'macOS' : 'Windows',
    arch: platform.arch,
    shimsPath: '~/.envhub/shims'
  }

  // 检查 PATH 状态
  try {
    pathStatus.value.configured = await window.electron.ipcRenderer.invoke('envhub:path:check')
    pathStatus.value.path = systemInfo.value.shimsPath
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to check PATH status: ${message}`, 'error')
  }
})
</script>

<template>
  <div class="max-w-[1400px] mx-auto">
    <!-- 系统信息 -->
    <a-row :gutter="16">
      <a-col :span="24">
        <a-card title="系统信息" :bordered="false">
          <a-descriptions :column="3" bordered>
            <a-descriptions-item label="操作系统">
              {{ systemInfo.platform }}
            </a-descriptions-item>
            <a-descriptions-item label="架构">
              {{ systemInfo.arch }}
            </a-descriptions-item>
            <a-descriptions-item label="Shims 路径">
              <a-tag>{{ systemInfo.shimsPath }}</a-tag>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-col>
    </a-row>

    <!-- PATH 环境变量 -->
    <a-row :gutter="16" class="mt-4">
      <a-col :span="24">
        <a-card title="PATH 环境变量" :bordered="false">
          <a-alert v-if="!pathStatus.configured" type="info" closable>
            <template #icon>
              <icon-clock-circle />
            </template>
            PATH 环境变量将在启用工具时自动配置到 Shell 配置文件（.zshrc 等）。
          </a-alert>
          <a-alert v-else type="success" closable>
            <template #icon>
              <icon-check />
            </template>
            PATH 已配置：{{ pathStatus.path }}
          </a-alert>
        </a-card>
      </a-col>
    </a-row>

    <!-- 快速开始 -->
    <a-row :gutter="16" class="mt-4">
      <a-col :span="24">
        <a-card title="快速开始" :bordered="false">
          <a-space direction="vertical" :size="16" class="w-full">
            <div class="flex gap-4 items-start">
              <div
                class="w-8 h-8 rounded-full bg-[#165dff] text-white flex items-center justify-center font-semibold flex-shrink-0"
              >
                1
              </div>
              <div class="flex-1">
                <h4 class="m-0 mb-1 text-[15px] font-medium">选择工具版本</h4>
                <p class="m-0 text-gray-500 text-sm">
                  前往"编程语言"页面，浏览 Python、Node.js、Java 的在线版本列表
                </p>
              </div>
            </div>
            <div class="flex gap-4 items-start">
              <div
                class="w-8 h-8 rounded-full bg-[#165dff] text-white flex items-center justify-center font-semibold flex-shrink-0"
              >
                2
              </div>
              <div class="flex-1">
                <h4 class="m-0 mb-1 text-[15px] font-medium">下载并安装</h4>
                <p class="m-0 text-gray-500 text-sm">
                  点击"安装"按钮下载工具（Python 需要手动运行安装器，其他工具自动安装）
                </p>
              </div>
            </div>
            <div class="flex gap-4 items-start">
              <div
                class="w-8 h-8 rounded-full bg-[#165dff] text-white flex items-center justify-center font-semibold flex-shrink-0"
              >
                3
              </div>
              <div class="flex-1">
                <h4 class="m-0 mb-1 text-[15px] font-medium">启用工具</h4>
                <p class="m-0 text-gray-500 text-sm">
                  安装完成后，点击"启用"按钮设置为当前版本（自动配置 PATH 环境变量）
                </p>
              </div>
            </div>
            <div class="flex gap-4 items-start">
              <div
                class="w-8 h-8 rounded-full bg-[#165dff] text-white flex items-center justify-center font-semibold flex-shrink-0"
              >
                4
              </div>
              <div class="flex-1">
                <h4 class="m-0 mb-1 text-[15px] font-medium">开始使用</h4>
                <p class="m-0 text-gray-500 text-sm">
                  重启终端后，直接使用 python、node、psql、java 等命令（停用工具会移除环境变量）
                </p>
              </div>
            </div>
          </a-space>
        </a-card>
      </a-col>
    </a-row>

    <!-- 关于 -->
    <a-row :gutter="16" class="mt-4">
      <a-col :span="24">
        <a-card title="关于" :bordered="false">
          <a-descriptions :column="3" bordered>
            <a-descriptions-item label="应用名称">EnvHub</a-descriptions-item>
            <a-descriptions-item label="版本">1.0.0</a-descriptions-item>
            <a-descriptions-item label="作者">Junsen</a-descriptions-item>
            <a-descriptions-item label="描述" :span="2">
              本地开发环境管理器，支持 Python、Node.js、PostgreSQL 的多版本离线安装与管理
            </a-descriptions-item>
            <a-descriptions-item label="技术栈" :span="2">
              Electron + Vue 3 + TypeScript + Arco Design
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>
