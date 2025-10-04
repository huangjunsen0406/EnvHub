<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { IconCheck, IconClose, IconClockCircle } from '@arco-design/web-vue/es/icon'
import { useToolsStore } from '../store/tools'

const toolsStore = useToolsStore()

const systemInfo = ref({
  platform: '',
  arch: '',
  shimsPath: ''
})

const toolStatus = ref([
  { name: 'Python', current: '-', installed: 0, icon: '🐍', color: '#3776ab' },
  { name: 'Node.js', current: '-', installed: 0, icon: '📦', color: '#339933' },
  { name: 'PostgreSQL', current: '-', installed: 0, icon: '🐘', color: '#336791' }
])

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

  // 加载已下载的 Python 安装包
  toolsStore.loadDownloadedInstallers()

  // 获取已安装工具
  const installed = await window.electron.ipcRenderer.invoke('envhub:installed:list')

  // Python 显示已下载的安装包数量（在线模式）
  const downloadedCount = Object.keys(toolsStore.downloadedInstallers.python || {}).length
  toolStatus.value[0].installed = downloadedCount
  toolStatus.value[0].current = installed.current?.python || '-'

  // Node.js 和 PostgreSQL 显示已安装的版本数量
  toolStatus.value[1].installed = installed.node?.length || 0
  toolStatus.value[1].current = installed.current?.node || '-'
  toolStatus.value[2].installed = installed.pg?.length || 0
  toolStatus.value[2].current = installed.current?.pg || '-'

  // 检查 PATH 状态
  try {
    pathStatus.value.configured = await window.electron.ipcRenderer.invoke('envhub:path:check')
    pathStatus.value.path = systemInfo.value.shimsPath
  } catch (error) {
    console.error('Failed to check PATH status:', error)
  }
})
</script>

<template>
  <div class="dashboard">
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

    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="8" v-for="tool in toolStatus" :key="tool.name">
        <a-card :bordered="false" hoverable>
          <div class="tool-card">
            <div class="tool-header">
              <span class="tool-icon">{{ tool.icon }}</span>
              <span class="tool-name">{{ tool.name }}</span>
            </div>
            <a-divider />
            <a-space direction="vertical" :size="12" style="width: 100%">
              <div class="tool-info">
                <span class="info-label">当前版本：</span>
                <a-tag v-if="tool.current !== '-'" color="green">{{ tool.current }}</a-tag>
                <span v-else class="text-secondary">未设置</span>
              </div>
              <div class="tool-info">
                <span class="info-label">已安装：</span>
                <a-tag>{{ tool.installed }} 个版本</a-tag>
              </div>
            </a-space>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="24">
        <a-card title="PATH 环境变量" :bordered="false">
          <a-alert v-if="!pathStatus.configured" type="warning" closable>
            <template #icon>
              <icon-clock-circle />
            </template>
            尚未配置 PATH 环境变量，请前往"设置"页面配置后才能在终端中使用工具。
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

    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="24">
        <a-card title="快速开始" :bordered="false">
          <a-space direction="vertical" :size="16" style="width: 100%">
            <div class="step-item">
              <div class="step-number">1</div>
              <div class="step-content">
                <h4>设置离线包目录</h4>
                <p>前往"设置"页面，选择包含 manifest.json 的离线包目录</p>
              </div>
            </div>
            <div class="step-item">
              <div class="step-number">2</div>
              <div class="step-content">
                <h4>安装开发工具</h4>
                <p>在"工具管理"页面选择需要的 Python、Node.js、PostgreSQL 版本进行安装</p>
              </div>
            </div>
            <div class="step-item">
              <div class="step-number">3</div>
              <div class="step-content">
                <h4>配置 PATH</h4>
                <p>返回"设置"页面，一键添加 ~/.envhub/shims 到系统 PATH</p>
              </div>
            </div>
            <div class="step-item">
              <div class="step-number">4</div>
              <div class="step-content">
                <h4>开始使用</h4>
                <p>在终端中直接使用 python、node、psql 等命令</p>
              </div>
            </div>
          </a-space>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
}

.tool-card {
  padding: 8px;
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.tool-icon {
  font-size: 32px;
}

.tool-name {
  font-size: 18px;
  font-weight: 600;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-label {
  color: #86909c;
  font-size: 14px;
}

.text-secondary {
  color: #86909c;
}

.step-item {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #165dff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.step-content h4 {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 500;
}

.step-content p {
  margin: 0;
  color: #86909c;
  font-size: 14px;
}
</style>
