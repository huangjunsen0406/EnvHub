<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  IconDashboard,
  IconCodeSquare,
  IconSettings,
  IconBook,
  IconMenuFold,
  IconMenuUnfold
} from '@arco-design/web-vue/es/icon'
import Dashboard from './views/Dashboard.vue'
import Tools from './views/Tools.vue'
import Settings from './views/Settings.vue'
import Logs from './views/Logs.vue'
import { useLogsStore } from './store/logs'

const logsStore = useLogsStore()

const currentView = ref('dashboard')
const collapsed = ref(false)

const menuItems = [
  { key: 'dashboard', label: '仪表盘', icon: IconDashboard },
  { key: 'tools', label: '工具管理', icon: IconCodeSquare },
  { key: 'logs', label: '日志', icon: IconBook },
  { key: 'settings', label: '设置', icon: IconSettings }
]

onMounted(() => {
  // 初始化日志监听器
  logsStore.initLogListener()
  logsStore.addLog('EnvHub 日志系统已启动', 'info')
})
</script>

<template>
  <a-layout class="layout-container">
    <a-layout-sider
      :collapsed="collapsed"
      :width="220"
      :collapsed-width="60"
      class="layout-sider"
      breakpoint="lg"
      @collapse="collapsed = $event"
    >
      <div class="sider-container">
        <div class="sider-top">
          <div class="logo">
            <span v-if="!collapsed" class="logo-text">EnvHub</span>
            <span v-else class="logo-icon">E</span>
          </div>
          <a-menu
            :selected-keys="[currentView]"
            :style="{ width: '100%' }"
            @menu-item-click="currentView = $event"
          >
            <a-menu-item v-for="item in menuItems" :key="item.key">
              <template #icon>
                <component :is="item.icon" />
              </template>
              {{ item.label }}
            </a-menu-item>
          </a-menu>
        </div>

        <div class="sider-bottom">
          <a-button
            type="text"
            :style="{ width: '100%', height: '48px' }"
            @click="collapsed = !collapsed"
          >
            <template #icon>
              <icon-menu-fold v-if="!collapsed" />
              <icon-menu-unfold v-else />
            </template>
            <span v-if="!collapsed">收起菜单</span>
          </a-button>
        </div>
      </div>
    </a-layout-sider>

    <a-layout>
      <a-layout-header class="layout-header">
        <div class="header-left">
          <span class="header-title">{{
            menuItems.find((m) => m.key === currentView)?.label
          }}</span>
        </div>
        <div class="header-right">
          <a-space>
            <a-tag color="green" size="small">v1.0.0</a-tag>
          </a-space>
        </div>
      </a-layout-header>

      <a-layout-content class="layout-content">
        <div class="content-wrapper">
          <Dashboard v-if="currentView === 'dashboard'" />
          <Tools v-else-if="currentView === 'tools'" />
          <Logs v-else-if="currentView === 'logs'" />
          <Settings v-else-if="currentView === 'settings'" />
        </div>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.layout-container {
  height: 100vh;
  background: #f5f5f5;
}

.layout-sider {
  background: #fff;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.05);
}

.sider-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sider-top {
  flex: 1;
  overflow-y: auto;
}

.sider-bottom {
  border-top: 1px solid #f0f0f0;
  padding: 8px;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
  font-size: 20px;
  color: #165dff;
}

.logo-text {
  letter-spacing: 1px;
}

.logo-icon {
  font-size: 24px;
  font-weight: bold;
}

.layout-header {
  height: 60px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-title {
  font-size: 16px;
  font-weight: 500;
  color: #1d2129;
}

.header-right {
  display: flex;
  align-items: center;
}

.layout-content {
  background: #f5f5f5;
  overflow: auto;
}

.content-wrapper {
  padding: 24px;
  min-height: calc(100vh - 60px);
}
</style>
