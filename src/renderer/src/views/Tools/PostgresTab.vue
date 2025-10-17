<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  IconDelete,
  IconCloudDownload,
  IconRefresh,
  IconPlus,
  IconEye,
  IconEyeInvisible,
  IconExport,
  IconImport
} from '@arco-design/web-vue/es/icon'
import { Message, Modal } from '@arco-design/web-vue'
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
} = useToolVersion('pg')

const pgStatus = ref<
  Record<string, { running: boolean; pid?: number; port?: number; dataDir?: string }>
>({})

const state = reactive({
  cluster: 'main',
  activeTab: 'versions' as 'versions' | 'databases'
})

// 操作状态追踪 - 按版本追踪而不是全局状态
const versionLoading = ref<Record<string, boolean>>({})

// 获取指定版本的加载状态
function isVersionLoading(version: string): boolean {
  return versionLoading.value[version] || false
}

// 设置指定版本的加载状态
function setVersionLoading(version: string, loading: boolean): void {
  versionLoading.value[version] = loading
}

// 数据库管理相关
interface DatabaseWithMetadata {
  dbName: string
  username: string
  password: string
  note: string
  location: string
}

const databases = ref<DatabaseWithMetadata[]>([])
const showAddDbModal = ref(false)
const addDbForm = reactive({
  dbName: '',
  username: '',
  password: ''
})
const loadingDatabases = ref(false)

// 密码显示控制
const passwordVisible = ref<Record<string, boolean>>({})

// 备份/导入相关
const backupLoading = ref<Record<string, boolean>>({})
const restoreLoading = ref<Record<string, boolean>>({})
const showBackupLogModal = ref(false)
const backupLogContent = ref('')

// 改密相关
const showChangePwdModal = ref(false)
const changePwdForm = reactive({
  dbName: '',
  username: '',
  password: ''
})

const currentPgVersion = computed(() => {
  const current = onlineVersions.value.find((v) => isCurrent(v.version))
  return current?.version || ''
})

async function checkPgStatus(v: string): Promise<void> {
  try {
    const dataDir = `~/.envhub/pg/${v}/${state.cluster}`
    const status = await window.electron.ipcRenderer.invoke('envhub:pg:status', {
      pgVersion: v,
      dataDir
    })
    pgStatus.value[v] = status
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const logsStore = useLogsStore()
    logsStore.addLog(`Failed to check PG status: ${message}`, 'error')
  }
}

// 重写 useVersion 以支持 PostgreSQL 状态检查
async function usePgVersion(version: string): Promise<void> {
  if (isVersionLoading(version)) return
  setVersionLoading(version, true)
  try {
    await useVersion(version)
    await checkPgStatus(version)
  } finally {
    setVersionLoading(version, false)
  }
}

// 重写 unsetCurrent 以支持 PostgreSQL 状态检查
async function unsetPgCurrent(): Promise<void> {
  const versionToUnset = currentPgVersion.value
  if (!versionToUnset) return

  if (isVersionLoading(versionToUnset)) return
  setVersionLoading(versionToUnset, true)
  try {
    await unsetCurrent()
    // PostgreSQL 停用后刷新所有版本状态
    const versions = Object.keys(pgStatus.value)
    for (const v of versions) {
      await checkPgStatus(v)
    }
  } finally {
    setVersionLoading(versionToUnset, false)
  }
}

// 加载数据库列表（带元数据）
async function loadDatabases(): Promise<void> {
  if (!currentPgVersion.value) {
    Message.warning('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    loadingDatabases.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:pg:getDatabasesWithMetadata', {
      pgVersion: currentPgVersion.value
    })
    databases.value = result.databases || []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`加载数据库列表失败: ${message}`)
  } finally {
    loadingDatabases.value = false
  }
}

// 切换密码显示/隐藏
function togglePasswordVisible(dbName: string): void {
  passwordVisible.value[dbName] = !passwordVisible.value[dbName]
}

// 生成随机密码
function generatePassword(): void {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let password = ''
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  addDbForm.password = password
}

// 生成改密用的随机密码
function generatePasswordForChange(): void {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let password = ''
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  changePwdForm.password = password
}

// 打开改密弹窗
function openChangePwdModal(dbName: string, username: string): void {
  changePwdForm.dbName = dbName
  changePwdForm.username = username
  changePwdForm.password = ''
  showChangePwdModal.value = true
}

// 执行改密
async function handleChangePassword(): Promise<void> {
  if (!changePwdForm.password) {
    Message.warning('请输入新密码')
    return
  }

  if (!currentPgVersion.value) {
    Message.error('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:pg:changePassword', {
      pgVersion: currentPgVersion.value,
      username: changePwdForm.username,
      newPassword: changePwdForm.password
    })

    Message.success('密码修改成功')
    showChangePwdModal.value = false
    await loadDatabases()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`修改密码失败: ${message}`)
  }
}

// 删除数据库
async function handleDeleteDatabase(dbName: string): Promise<void> {
  if (!currentPgVersion.value) {
    Message.error('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:pg:deleteDatabase', {
      pgVersion: currentPgVersion.value,
      dbName
    })

    Message.success('数据库删除成功')
    await loadDatabases()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'

    // 检测是否是数据库被占用的错误
    if (
      message.includes('is being accessed by other users') ||
      message.includes('other session using the database')
    ) {
      Message.warning({
        content: `无法删除数据库 ${dbName}：数据库正在被其他会话访问，请先关闭所有数据库客户端（如 Navicat、DBeaver、pgAdmin 等）的连接后重试`,
        duration: 5000
      })
    } else {
      Message.error(`删除数据库失败: ${message}`)
    }
  }
}

// 添加数据库
async function handleAddDatabase(): Promise<void> {
  if (!addDbForm.dbName || !addDbForm.username || !addDbForm.password) {
    Message.warning('请填写完整的数据库信息')
    return
  }

  if (!currentPgVersion.value) {
    Message.error('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:pg:createUserDb', {
      pgVersion: currentPgVersion.value,
      dbName: addDbForm.dbName,
      username: addDbForm.username,
      password: addDbForm.password
    })

    Message.success('数据库创建成功')
    showAddDbModal.value = false
    addDbForm.dbName = ''
    addDbForm.username = ''
    addDbForm.password = ''
    await loadDatabases()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    Message.error(`创建数据库失败: ${message}`)
  }
}

// 切换到数据库管理时加载数据库列表
function switchToDatabase(): void {
  state.activeTab = 'databases'
  loadDatabases()
}

// 备份数据库
async function handleBackup(dbName: string, username: string, password: string): Promise<void> {
  if (!currentPgVersion.value) {
    Message.error('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    // 选择保存路径
    const selectResult = await window.electron.ipcRenderer.invoke('envhub:pg:selectBackupPath', {
      dbName
    })

    if (selectResult.canceled) {
      return
    }

    backupLoading.value[dbName] = true
    backupLogContent.value = ''
    showBackupLogModal.value = true

    // 监听备份日志
    const logListener = (_evt: unknown, message: string): void => {
      backupLogContent.value += message
    }
    window.electron.ipcRenderer.on('envhub:pg:backup:log', logListener)

    try {
      await window.electron.ipcRenderer.invoke('envhub:pg:backup', {
        pgVersion: currentPgVersion.value,
        dbName,
        username,
        password,
        filePath: selectResult.filePath
      })

      backupLogContent.value += '\n✅ 备份成功\n'
      Message.success('数据库备份成功')
    } finally {
      // @ts-ignore - removeListener is deprecated but required for compatibility
      window.electron.ipcRenderer.removeListener('envhub:pg:backup:log', logListener)
      backupLoading.value[dbName] = false
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    backupLogContent.value += `\n❌ 备份失败: ${message}\n`
    Message.error(`备份失败: ${message}`)
    backupLoading.value[dbName] = false
  }
}

// 导入/恢复数据库
async function handleRestore(dbName: string, username: string, password: string): Promise<void> {
  if (!currentPgVersion.value) {
    Message.error('请先启用一个 PostgreSQL 版本')
    return
  }

  try {
    // 选择备份文件
    const selectResult = await window.electron.ipcRenderer.invoke('envhub:pg:selectRestoreFile')

    if (selectResult.canceled) {
      return
    }

    // 确认导入
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '确认导入',
        content: `即将导入备份到数据库 ${dbName}，现有数据可能被覆盖，是否继续？`,
        okText: '确认导入',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })

    if (!confirmed) {
      return
    }

    restoreLoading.value[dbName] = true
    backupLogContent.value = ''
    showBackupLogModal.value = true

    // 监听导入日志
    const logListener = (_evt: unknown, message: string): void => {
      backupLogContent.value += message
    }
    window.electron.ipcRenderer.on('envhub:pg:restore:log', logListener)

    try {
      await window.electron.ipcRenderer.invoke('envhub:pg:restore', {
        pgVersion: currentPgVersion.value,
        dbName,
        username,
        password,
        filePath: selectResult.filePath
      })

      backupLogContent.value += '\n✅ 导入成功\n'
      Message.success('数据库导入成功')
      await loadDatabases()
    } finally {
      // @ts-ignore - removeListener is deprecated but required for compatibility
      window.electron.ipcRenderer.removeListener('envhub:pg:restore:log', logListener)
      restoreLoading.value[dbName] = false
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    backupLogContent.value += `\n❌ 导入失败: ${message}\n`
    Message.error(`导入失败: ${message}`)
    restoreLoading.value[dbName] = false
  }
}

// 关闭日志弹窗
function closeBackupLogModal(): void {
  showBackupLogModal.value = false
  backupLogContent.value = ''
}

onMounted(() => {
  // 初始化时不执行任何操作
})
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
              v-if="isCurrent(record.version) && pgStatus[record.version]?.running"
              color="arcoblue"
            >
              运行中 PID:{{ pgStatus[record.version].pid }} 端口:{{ pgStatus[record.version].port }}
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
              :loading="installingVersions[`pg-${record.version}`]"
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
              @click="usePgVersion(record.version)"
            >
              启用
            </a-button>
            <a-button
              v-if="isInstalled(record.version) && isCurrent(record.version)"
              type="outline"
              size="small"
              :loading="isVersionLoading(record.version)"
              :disabled="isVersionLoading(record.version)"
              @click="unsetPgCurrent()"
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
              @click="checkPgStatus(record.version)"
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
          当前版本: <span class="font-semibold">{{ currentPgVersion || '无' }}</span>
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
          { title: '用户名', dataIndex: 'username', width: 120 },
          { title: '密码', slotName: 'password', width: 180 },
          { title: '备份', slotName: 'backup', width: 150 },
          { title: '数据库位置', dataIndex: 'location', width: 120 },
          { title: '备注', dataIndex: 'note', width: 100 },
          { title: '操作', slotName: 'actions', width: 150 }
        ]"
        :data="databases"
        :loading="loadingDatabases"
        :pagination="{ pageSize: 20, showTotal: true }"
      >
        <template #password="{ record }">
          <a-space>
            <span v-if="passwordVisible[record.dbName]">{{ record.password || '未设置' }}</span>
            <span v-else>{{ record.password ? '••••••••' : '未设置' }}</span>
            <a-button
              v-if="record.password"
              type="text"
              size="small"
              @click="togglePasswordVisible(record.dbName)"
            >
              <template #icon>
                <icon-eye v-if="!passwordVisible[record.dbName]" />
                <icon-eye-invisible v-else />
              </template>
            </a-button>
          </a-space>
        </template>
        <template #backup="{ record }">
          <a-space>
            <a-button
              type="text"
              size="small"
              :loading="backupLoading[record.dbName]"
              @click="handleBackup(record.dbName, record.username, record.password)"
            >
              <template #icon>
                <icon-export />
              </template>
              备份
            </a-button>
            <a-button
              type="text"
              size="small"
              :loading="restoreLoading[record.dbName]"
              @click="handleRestore(record.dbName, record.username, record.password)"
            >
              <template #icon>
                <icon-import />
              </template>
              导入
            </a-button>
          </a-space>
        </template>
        <template #actions="{ record }">
          <a-space>
            <a-button
              type="text"
              status="success"
              size="small"
              @click="openChangePwdModal(record.dbName, record.username)"
            >
              改密
            </a-button>
            <a-popconfirm
              v-if="record.dbName !== 'postgres'"
              content="确定要删除此数据库吗？"
              @ok="handleDeleteDatabase(record.dbName)"
            >
              <a-button type="text" status="danger" size="small">删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </a-table>
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
        <a-form-item label="用户名" required>
          <a-input v-model="addDbForm.username" placeholder="请输入用户名" />
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password v-model="addDbForm.password" placeholder="请输入密码">
            <template #append>
              <a-button type="text" size="small" @click="generatePassword()">生成</a-button>
            </template>
          </a-input-password>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 改密弹窗 -->
    <a-modal
      v-model:visible="showChangePwdModal"
      :title="`设置数据库 【${changePwdForm.dbName}】 密码`"
      @ok="handleChangePassword"
      @cancel="showChangePwdModal = false"
    >
      <a-form :model="changePwdForm" layout="vertical">
        <a-form-item label="用户名">
          <a-input v-model="changePwdForm.username" disabled />
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password v-model="changePwdForm.password" placeholder="请输入新密码">
            <template #append>
              <a-button type="text" size="small" @click="generatePasswordForChange()">
                <template #icon>
                  <icon-refresh />
                </template>
              </a-button>
            </template>
          </a-input-password>
        </a-form-item>
      </a-form>
    </a-modal>

    <InstallProgressModal :progress="installProgress" @close="closeInstallProgress" />

    <!-- 备份/导入日志弹窗 -->
    <a-modal
      v-model:visible="showBackupLogModal"
      title="备份/导入日志"
      :footer="false"
      width="800px"
    >
      <div
        class="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto whitespace-pre-wrap"
      >
        {{ backupLogContent || '等待日志输出...' }}
      </div>
      <template #footer>
        <a-button type="primary" @click="closeBackupLogModal">关闭</a-button>
      </template>
    </a-modal>
  </div>
</template>
