<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  IconDashboard,
  IconCode,
  IconStorage,
  IconSettings,
  IconBook,
  IconMenuFold,
  IconMenuUnfold
} from '@arco-design/web-vue/es/icon'
import Dashboard from './views/Dashboard.vue'
import Languages from './views/Languages.vue'
import Databases from './views/Databases.vue'
import Settings from './views/Settings.vue'
import Logs from './views/Logs.vue'
import { useLogsStore } from './store/logs'

const logsStore = useLogsStore()

const currentView = ref('dashboard')
const collapsed = ref(false)

const menuItems = [
  { key: 'dashboard', label: '仪表盘', icon: IconDashboard },
  { key: 'languages', label: '编程语言', icon: IconCode },
  { key: 'databases', label: '数据库', icon: IconStorage },
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
  <a-layout class="h-screen bg-gray-100">
    <a-layout-sider
      :collapsed="collapsed"
      :width="220"
      :collapsed-width="60"
      class="bg-white shadow-[2px_0_8px_rgba(0,0,0,0.05)]"
      breakpoint="lg"
      @collapse="collapsed = $event"
    >
      <div class="flex flex-col h-full">
        <div class="flex-1 overflow-y-auto">
          <div
            class="h-[60px] flex items-center justify-center border-b border-gray-200 font-semibold text-xl text-[#165dff]"
          >
            <span v-if="!collapsed" class="tracking-wider">EnvHub</span>
            <span v-else class="text-2xl font-bold">E</span>
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

        <div class="border-t border-gray-200 p-2">
          <a-button type="text" class="w-full h-12" @click="collapsed = !collapsed">
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
      <a-layout-header
        class="h-[60px] bg-white border-b border-gray-200 flex items-center justify-between px-6"
      >
        <div class="flex items-center gap-4">
          <span class="text-base font-medium text-[#1d2129]">{{
            menuItems.find((m) => m.key === currentView)?.label
          }}</span>
        </div>
        <div class="flex items-center">
          <a-space>
            <a-tag color="green" size="small">v1.0.0</a-tag>
          </a-space>
        </div>
      </a-layout-header>

      <a-layout-content class="bg-gray-100 overflow-auto">
        <div class="p-6 min-h-[calc(100vh-60px)]">
          <Dashboard v-if="currentView === 'dashboard'" />
          <Languages v-else-if="currentView === 'languages'" />
          <Databases v-else-if="currentView === 'databases'" />
          <Logs v-else-if="currentView === 'logs'" />
          <Settings v-else-if="currentView === 'settings'" />
        </div>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>
