<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import {
  IconDelete,
  IconCloudDownload,
  IconRefresh,
  IconPlus
} from '@arco-design/web-vue/es/icon'
import { Message } from '@arco-design/web-vue'
import { useToolVersion } from './composables/useToolVersion'
import { useLogsStore } from '../../store/logs'
import InstallProgressModal from './components/InstallProgressModal.vue'

const {
  fetchingVersions,
  installingVersions,
  installProgress,
  onlineVersions,
  isInstalled,
  isCurrent,
  refreshVersions,
  useVersion,
  unsetCurrent,
  uninstall,
  installOnline,
  closeInstallProgress
} = useToolVersion('mysql')

const mysqlStatus = ref<
  Record<string, { running: boolean; pid?: number; port?: number; dataDir?: string }>
>({})

const state = reactive({
  cluster: 'main',
  activeTab: 'versions' as 'versions' | 'databases' | 'users'
})

// 操作状态追踪 - 按版本追踪
const versionLoading = ref<Record<string, boolean>>({})

function isVersionLoading(version: string): boolean {
  return versionLoading.value[version] || false
}

function setVersionLoading(version: string, loading: boolean): void {
  versionLoading.value[version] = loading
}

// 数据库管理相关
interface DatabaseWithMetadata {
  dbName: string
  charset: string
  collation: string
  note: string
  createdAt: string
}

const databases = ref<DatabaseWithMetadata[]>([])
const showAddDbModal = ref(false)
const addDbForm = reactive({
  dbName: '',
  charset: 'utf8mb4',
  note: ''
})
const loadingDatabases = ref(false)

const currentMysqlVersion = computed(() => {
  const current = onlineVersions.value.find((v) => isCurrent(v.version))
  return current?.version || ''
})

async function checkMysqlStatus(v: string): Promise<void> {
  try {
    const status = await window.electron.ipcRenderer.invoke('envhub:mysql:status', {
      mysqlVersion: v,
      port: 3306
    })
    mysqlStatus.value[v] = status
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to check MySQL status: ${message}`, 'error')
  }
}

// 重写 useVersion 以支持 MySQL 状态检查
async function useMysqlVersion(version: string): Promise<void> {
  if (isVersionLoading(version)) return
  setVersionLoading(version, true)
  try {
    await useVersion(version)
    await checkMysqlStatus(version)
  } finally {
    setVersionLoading(version, false)
  }
}

// 重写 unsetCurrent 以支持 MySQL 状态检查
async function unsetMysqlCurrent(): Promise<void> {
  const versionToUnset = currentMysqlVersion.value
  if (!versionToUnset) return

  if (isVersionLoading(versionToUnset)) return
  setVersionLoading(versionToUnset, true)
  try {
    await unsetCurrent()
    const versions = Object.keys(mysqlStatus.value)
    for (const v of versions) {
      await checkMysqlStatus(v)
    }
  } finally {
    setVersionLoading(versionToUnset, false)
  }
}

// 加载数据库列表
async function loadDatabases(): Promise<void> {
  if (!currentMysqlVersion.value) {
    Message.warning('请先启用一个 MySQL 版本')
    return
  }

  try {
    loadingDatabases.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:mysql:getDatabasesWithMetadata', {
      mysqlVersion: currentMysqlVersion.value
    })
    databases.value = result.databases || []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`加载数据库列表失败: ${message}`)
  } finally {
    loadingDatabases.value = false
  }
}

// 添加数据库
async function handleAddDatabase(): Promise<void> {
  if (!addDbForm.dbName) {
    Message.warning('请填写数据库名称')
    return
  }

  if (!currentMysqlVersion.value) {
    Message.error('请先启用一个 MySQL 版本')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:createDatabase', {
      mysqlVersion: currentMysqlVersion.value,
      dbName: addDbForm.dbName,
      charset: addDbForm.charset,
      note: addDbForm.note
    })

    Message.success('数据库创建成功')
    showAddDbModal.value = false
    addDbForm.dbName = ''
    addDbForm.charset = 'utf8mb4'
    addDbForm.note = ''
    await loadDatabases()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`创建数据库失败: ${message}`)
  }
}

// 删除数据库
async function handleDeleteDatabase(dbName: string): Promise<void> {
  if (!currentMysqlVersion.value) {
    Message.error('请先启用一个 MySQL 版本')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:deleteDatabase', {
      mysqlVersion: currentMysqlVersion.value,
      dbName
    })

    Message.success('数据库删除成功')
    await loadDatabases()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`删除数据库失败: ${message}`)
  }
}

// 切换到数据库管理时加载数据库列表
function switchToDatabase(): void {
  state.activeTab = 'databases'
  loadDatabases()
}

// 切换到用户管理
function switchToUsers(): void {
  state.activeTab = 'users'
  // TODO: 加载用户列表
}
</script>

<template>
  <div class="w-full">
    <!-- Tab 切换和操作按钮 -->
    <div class="mb-4 flex gap-2">
      <a-button
        :type="state.activeTab === 'versions' ? 'primary' : 'outline'"
        size="small"
        @click="state.activeTab = 'versions'"
      >
        版本管理
      </a-button>
      <a-button
        :type="state.activeTab === 'databases' ? 'primary' : 'outline'"
        size="small"
        @click="switchToDatabase()"
      >
        数据库管理
      </a-button>
      <a-button
        :type="state.activeTab === 'users' ? 'primary' : 'outline'"
        size="small"
        @click="switchToUsers()"
      >
        用户管理
      </a-button>
      <a-button type="outline" size="small" :loading="fetchingVersions" @click="refreshVersions()">
        <template #icon>
          <icon-refresh />
        </template>
        刷新版本列表
      </a-button>
    </div>

    <!-- 版本管理 -->
    <div v-if="state.activeTab === 'versions'" class="w-full">
      <a-table
        :columns="[
          { title: '版本', dataIndex: 'version', width: 150 },
          { title: '状态', slotName: 'status', width: 200 },
          { title: '操作', slotName: 'actions' }
        ]"
        :data="onlineVersions"
        :pagination="{ pageSize: 20, showTotal: true }"
      >
        <template #status="{ record }">
          <a-space>
            <a-tag v-if="isInstalled(record.version)" color="green">已安装</a-tag>
            <a-tag v-else color="gray">未安装</a-tag>
            <a-tag v-if="isCurrent(record.version)" color="blue">当前版本</a-tag>
            <a-tag
              v-if="isCurrent(record.version) && mysqlStatus[record.version]?.running"
              color="arcoblue"
            >
              运行中 PID:{{ mysqlStatus[record.version].pid }} 端口:{{ mysqlStatus[record.version].port }}
            </a-tag>
            <a-tag v-else-if="isCurrent(record.version) && isInstalled(record.version)" color="gray"
              >已停止</a-tag
            >
            <a-tag v-if="record.date" color="arcoblue">
              {{ new Date(record.date).toLocaleDateString() }}
            </a-tag>
          </a-space>
        </template>
        <template #actions="{ record }">
          <a-space>
            <a-button
              v-if="!isInstalled(record.version)"
              type="primary"
              size="small"
              :loading="installingVersions[`mysql-${record.version}`]"
              @click="installOnline(record.version, record.url)"
            >
              <template #icon>
                <icon-cloud-download />
              </template>
              安装
            </a-button>
            <a-button
              v-if="isInstalled(record.version) && !isCurrent(record.version)"
              type="outline"
              size="small"
              :loading="isVersionLoading(record.version)"
              :disabled="isVersionLoading(record.version)"
              @click="useMysqlVersion(record.version)"
            >
              启用
            </a-button>
            <a-button
              v-if="isInstalled(record.version) && isCurrent(record.version)"
              type="outline"
              size="small"
              :loading="isVersionLoading(record.version)"
              :disabled="isVersionLoading(record.version)"
              @click="unsetMysqlCurrent()"
            >
              停用
            </a-button>
            <a-popconfirm content="确定要卸载此版本吗？" @ok="uninstall(record.version)">
              <a-button
                v-if="isInstalled(record.version) && !isCurrent(record.version)"
                type="outline"
                status="danger"
                size="small"
              >
                <template #icon>
                  <icon-delete />
                </template>
                卸载
              </a-button>
            </a-popconfirm>
            <a-button
              v-if="isInstalled(record.version) && isCurrent(record.version)"
              type="text"
              size="small"
              @click="checkMysqlStatus(record.version)"
            >
              刷新状态
            </a-button>
          </a-space>
        </template>
      </a-table>
    </div>

    <!-- 数据库管理 -->
    <div v-if="state.activeTab === 'databases'" class="w-full">
      <div class="mb-4 flex justify-between items-center">
        <div class="text-sm text-gray-600">
          当前版本: <span class="font-semibold">{{ currentMysqlVersion || '无' }}</span>
        </div>
        <a-button type="primary" size="small" @click="showAddDbModal = true">
          <template #icon>
            <icon-plus />
          </template>
          添加数据库
        </a-button>
      </div>

      <a-table
        :columns="[
          { title: '数据库名称', dataIndex: 'dbName', width: 150 },
          { title: '字符集', dataIndex: 'charset', width: 120 },
          { title: '排序规则', dataIndex: 'collation', width: 180 },
          { title: '备注', dataIndex: 'note', width: 150 },
          { title: '操作', slotName: 'actions', width: 150 }
        ]"
        :data="databases"
        :loading="loadingDatabases"
        :pagination="{ pageSize: 20, showTotal: true }"
      >
        <template #actions="{ record }">
          <a-space>
            <a-popconfirm
              v-if="!['mysql', 'sys', 'performance_schema', 'information_schema'].includes(record.dbName)"
              content="确定要删除此数据库吗？"
              @ok="handleDeleteDatabase(record.dbName)"
            >
              <a-button type="text" status="danger" size="small">删除</a-button>
            </a-popconfirm>
            <span v-else class="text-gray-400 text-xs">系统库</span>
          </a-space>
        </template>
      </a-table>
    </div>

    <!-- 用户管理（待实现） -->
    <div v-if="state.activeTab === 'users'" class="w-full">
      <div class="text-center py-20 text-gray-500">
        <div class="mb-4 text-4xl">👤</div>
        <div>用户管理功能开发中...</div>
        <div class="text-sm mt-2">即将支持：用户创建/删除、密码管理、权限分配</div>
      </div>
    </div>

    <!-- 添加数据库弹窗 -->
    <a-modal
      v-model:visible="showAddDbModal"
      title="添加数据库"
      @ok="handleAddDatabase"
      @cancel="showAddDbModal = false"
    >
      <a-form :model="addDbForm" layout="vertical">
        <a-form-item label="数据库名称" required>
          <a-input v-model="addDbForm.dbName" placeholder="请输入数据库名称" />
        </a-form-item>
        <a-form-item label="字符集" required>
          <a-select v-model="addDbForm.charset">
            <a-option value="utf8mb4">utf8mb4</a-option>
            <a-option value="utf8">utf8</a-option>
            <a-option value="latin1">latin1</a-option>
            <a-option value="gbk">gbk</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model="addDbForm.note" placeholder="可选" />
        </a-form-item>
      </a-form>
    </a-modal>

    <InstallProgressModal :progress="installProgress" @close="closeInstallProgress" />
  </div>
</template>
