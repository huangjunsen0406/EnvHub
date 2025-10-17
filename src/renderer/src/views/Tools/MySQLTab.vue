<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
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

// 用户管理相关
interface MysqlUser {
  user: string
  host: string
  note?: string
  createdAt?: string
}

interface DatabaseGrant {
  database: string
  privileges: string[]
}

const users = ref<MysqlUser[]>([])
const showAddUserModal = ref(false)
const showGrantModal = ref(false)
const showPasswordModal = ref(false)
const loadingUsers = ref(false)
const selectedUser = ref<MysqlUser | null>(null)
const userDatabases = ref<DatabaseGrant[]>([])

const addUserForm = reactive({
  username: '',
  host: 'localhost',
  password: '',
  note: ''
})

const changePasswordForm = reactive({
  newPassword: '',
  confirmPassword: ''
})

const grantForm = reactive({
  database: '',
  privileges: [] as string[]
})

// 权限选项
const privilegeOptions = [
  { label: 'SELECT', value: 'SELECT' },
  { label: 'INSERT', value: 'INSERT' },
  { label: 'UPDATE', value: 'UPDATE' },
  { label: 'DELETE', value: 'DELETE' },
  { label: 'CREATE', value: 'CREATE' },
  { label: 'DROP', value: 'DROP' },
  { label: 'ALTER', value: 'ALTER' },
  { label: 'INDEX', value: 'INDEX' },
  { label: 'CREATE VIEW', value: 'CREATE VIEW' },
  { label: 'SHOW VIEW', value: 'SHOW VIEW' },
  { label: 'TRIGGER', value: 'TRIGGER' },
  { label: 'EXECUTE', value: 'EXECUTE' },
  { label: 'CREATE ROUTINE', value: 'CREATE ROUTINE' },
  { label: 'ALTER ROUTINE', value: 'ALTER ROUTINE' },
  { label: 'ALL PRIVILEGES', value: 'ALL PRIVILEGES' }
]

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
    const result = await window.electron.ipcRenderer.invoke(
      'envhub:mysql:getDatabasesWithMetadata',
      {
        mysqlVersion: currentMysqlVersion.value
      }
    )
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
  if (currentMysqlVersion.value) {
    loadUsers()
  }
}

// 用户管理相关函数
async function loadUsers(): Promise<void> {
  if (!currentMysqlVersion.value) return
  loadingUsers.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('envhub:mysql:listUsers', {
      mysqlVersion: currentMysqlVersion.value
    })

    // 获取元数据
    const metadata = await window.electron.ipcRenderer.invoke('envhub:mysql:getUserMetadata', {
      mysqlVersion: currentMysqlVersion.value
    })

    // 合并用户信息和元数据
    users.value = result.map((user: { username: string; host: string }) => {
      const meta = metadata.find(
        (m: { username: string; host: string; note?: string; createdAt?: string }) =>
          m.username === user.username && m.host === user.host
      )
      return {
        user: user.username,
        host: user.host,
        note: meta?.note || '',
        createdAt: meta?.createdAt || ''
      }
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`加载用户列表失败：${message}`)
  } finally {
    loadingUsers.value = false
  }
}

async function handleAddUser(): Promise<void> {
  if (!currentMysqlVersion.value) return
  if (!addUserForm.username || !addUserForm.password) {
    Message.warning('请填写用户名和密码')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:createUser', {
      mysqlVersion: currentMysqlVersion.value,
      username: addUserForm.username,
      host: addUserForm.host,
      password: addUserForm.password,
      note: addUserForm.note
    })
    Message.success(`用户 ${addUserForm.username}@${addUserForm.host} 创建成功`)
    showAddUserModal.value = false
    addUserForm.username = ''
    addUserForm.password = ''
    addUserForm.note = ''
    addUserForm.host = 'localhost'
    await loadUsers()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`创建用户失败：${message}`)
  }
}

async function handleDeleteUser(user: MysqlUser): Promise<void> {
  if (!currentMysqlVersion.value) return
  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:deleteUser', {
      mysqlVersion: currentMysqlVersion.value,
      username: user.user,
      host: user.host
    })
    Message.success(`用户 ${user.user}@${user.host} 已删除`)
    await loadUsers()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`删除用户失败：${message}`)
  }
}

function openPasswordModal(user: MysqlUser): void {
  selectedUser.value = user
  changePasswordForm.newPassword = ''
  changePasswordForm.confirmPassword = ''
  showPasswordModal.value = true
}

async function handleChangePassword(): Promise<void> {
  if (!currentMysqlVersion.value || !selectedUser.value) return

  if (!changePasswordForm.newPassword) {
    Message.warning('请输入新密码')
    return
  }

  if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
    Message.warning('两次输入的密码不一致')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:changePassword', {
      mysqlVersion: currentMysqlVersion.value,
      username: selectedUser.value.user,
      host: selectedUser.value.host,
      newPassword: changePasswordForm.newPassword
    })
    Message.success('密码修改成功')
    showPasswordModal.value = false
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`修改密码失败：${message}`)
  }
}

async function openGrantModal(user: MysqlUser): Promise<void> {
  selectedUser.value = user
  grantForm.database = ''
  grantForm.privileges = []
  showGrantModal.value = true

  // 加载用户已有的权限
  try {
    const grants = await window.electron.ipcRenderer.invoke('envhub:mysql:getUserDatabases', {
      mysqlVersion: currentMysqlVersion.value,
      username: user.user,
      host: user.host
    })
    userDatabases.value = grants
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`加载权限失败：${message}`)
  }

  // 确保数据库列表已加载
  if (databases.value.length === 0) {
    await loadDatabases()
  }
}

async function handleGrant(): Promise<void> {
  if (!currentMysqlVersion.value || !selectedUser.value) return

  if (!grantForm.database) {
    Message.warning('请选择数据库')
    return
  }

  if (grantForm.privileges.length === 0) {
    Message.warning('请选择至少一个权限')
    return
  }

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:grantPrivileges', {
      mysqlVersion: currentMysqlVersion.value,
      username: selectedUser.value.user,
      host: selectedUser.value.host,
      database: grantForm.database,
      privileges: [...grantForm.privileges] // 转换为普通数组
    })
    Message.success('权限授予成功')

    // 重新加载权限列表，但不关闭弹窗
    try {
      const grants = await window.electron.ipcRenderer.invoke('envhub:mysql:getUserDatabases', {
        mysqlVersion: currentMysqlVersion.value,
        username: selectedUser.value.user,
        host: selectedUser.value.host
      })
      userDatabases.value = grants
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      Message.error(`加载权限失败：${message}`)
    }

    // 清空表单
    grantForm.database = ''
    grantForm.privileges = []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`授权失败：${message}`)
  }
}

async function handleRevokeGrant(database: string): Promise<void> {
  if (!currentMysqlVersion.value || !selectedUser.value) return

  try {
    await window.electron.ipcRenderer.invoke('envhub:mysql:revokePrivileges', {
      mysqlVersion: currentMysqlVersion.value,
      username: selectedUser.value.user,
      host: selectedUser.value.host,
      database,
      privileges: ['ALL PRIVILEGES']
    })
    Message.success(`已撤销 ${database} 的所有权限`)
    // 重新加载权限列表
    await openGrantModal(selectedUser.value)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`撤销权限失败：${message}`)
  }
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
        刷新版本列表
      </a-button>
    </div>

    <!-- 版本管理 -->
    <div v-if="state.activeTab === 'versions'" class="w-full">
      <a-table
        :columns="[
          { title: '版本', dataIndex: 'version', width: 150, align: 'center' },
          { title: '状态', slotName: 'status', width: 200, align: 'center' },
          { title: '操作', slotName: 'actions', align: 'center' }
        ]"
        :data="onlineVersions"
        :pagination="{ pageSize: 10, showTotal: true }"
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
              运行中 PID:{{ mysqlStatus[record.version].pid }} 端口:{{
                mysqlStatus[record.version].port
              }}
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
                卸载
              </a-button>
            </a-popconfirm>
            <a-button
              v-if="isInstalled(record.version) && isCurrent(record.version)"
              type="outline"
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
        <a-button type="outline" size="small" @click="showAddDbModal = true"> 添加数据库 </a-button>
      </div>

      <a-table
        :columns="[
          { title: '数据库名称', dataIndex: 'dbName', width: 150, align: 'center' },
          { title: '字符集', dataIndex: 'charset', width: 120, align: 'center' },
          { title: '排序规则', dataIndex: 'collation', width: 180, align: 'center' },
          { title: '备注', dataIndex: 'note', width: 150, align: 'center' },
          { title: '操作', slotName: 'actions', width: 150, align: 'center' }
        ]"
        :data="databases"
        :loading="loadingDatabases"
        :pagination="{ pageSize: 10, showTotal: true }"
      >
        <template #actions="{ record }">
          <a-space>
            <a-popconfirm
              v-if="
                !['mysql', 'sys', 'performance_schema', 'information_schema'].includes(
                  record.dbName
                )
              "
              content="确定要删除此数据库吗？"
              @ok="handleDeleteDatabase(record.dbName)"
            >
              <a-button type="outline" status="danger" size="small">删除</a-button>
            </a-popconfirm>
            <span v-else class="text-gray-400 text-xs">系统库</span>
          </a-space>
        </template>
      </a-table>
    </div>

    <!-- 用户管理 -->
    <div v-if="state.activeTab === 'users'" class="w-full">
      <div class="mb-4 flex justify-between items-center">
        <div class="text-sm text-gray-600">
          当前版本: <span class="font-semibold">{{ currentMysqlVersion || '无' }}</span>
        </div>
        <a-button type="outline" size="small" @click="showAddUserModal = true"> 添加用户 </a-button>
      </div>

      <a-table
        :columns="[
          { title: '用户名', dataIndex: 'user', width: 150, align: 'center' },
          { title: '主机', dataIndex: 'host', width: 150, align: 'center' },
          { title: '备注', dataIndex: 'note', width: 200, align: 'center' },
          { title: '创建时间', slotName: 'createdAt', width: 180, align: 'center' },
          { title: '操作', slotName: 'actions', width: 200, align: 'center' }
        ]"
        :data="users"
        :loading="loadingUsers"
        :pagination="{ pageSize: 10, showTotal: true }"
      >
        <template #createdAt="{ record }">
          <span v-if="record.createdAt">
            {{ new Date(record.createdAt).toLocaleString() }}
          </span>
          <span v-else class="text-gray-400">-</span>
        </template>
        <template #actions="{ record }">
          <a-space>
            <a-button
              v-if="record.user !== 'root'"
              type="outline"
              size="small"
              @click="openPasswordModal(record)"
            >
              改密
            </a-button>
            <a-button type="outline" size="small" @click="openGrantModal(record)"> 权限 </a-button>
            <a-popconfirm
              v-if="record.user !== 'root'"
              content="确定要删除此用户吗？"
              @ok="handleDeleteUser(record)"
            >
              <a-button type="outline" status="danger" size="small">删除</a-button>
            </a-popconfirm>
            <span v-else class="text-gray-400 text-xs">系统用户</span>
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

    <!-- 添加用户弹窗 -->
    <a-modal
      v-model:visible="showAddUserModal"
      title="添加用户"
      @ok="handleAddUser"
      @cancel="showAddUserModal = false"
    >
      <a-form :model="addUserForm" layout="vertical">
        <a-form-item label="用户名" required>
          <a-input v-model="addUserForm.username" placeholder="请输入用户名" />
        </a-form-item>
        <a-form-item label="主机" required>
          <a-select v-model="addUserForm.host">
            <a-option value="localhost">localhost</a-option>
            <a-option value="%">% (所有主机)</a-option>
            <a-option value="127.0.0.1">127.0.0.1</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password v-model="addUserForm.password" placeholder="请输入密码" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model="addUserForm.note" placeholder="可选" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 修改密码弹窗 -->
    <a-modal
      v-model:visible="showPasswordModal"
      title="修改密码"
      @ok="handleChangePassword"
      @cancel="showPasswordModal = false"
    >
      <a-form :model="changePasswordForm" layout="vertical">
        <a-form-item label="用户">
          <!-- <a-input :value="`${selectedUser?.user}@${selectedUser?.host}`" disabled /> -->
          {{ selectedUser?.user }}@{{ selectedUser?.host }}
        </a-form-item>
        <a-form-item label="新密码" required>
          <a-input-password v-model="changePasswordForm.newPassword" placeholder="请输入新密码" />
        </a-form-item>
        <a-form-item label="确认密码" required>
          <a-input-password
            v-model="changePasswordForm.confirmPassword"
            placeholder="请再次输入密码"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 权限管理弹窗 -->
    <a-modal
      v-model:visible="showGrantModal"
      title="权限管理"
      width="800px"
      @ok="handleGrant"
      @cancel="showGrantModal = false"
    >
      <div class="mb-4">
        <div class="text-sm text-gray-600 mb-2">
          用户: <span class="font-semibold">{{ selectedUser?.user }}@{{ selectedUser?.host }}</span>
        </div>
      </div>

      <!-- 已有权限列表 -->
      <div v-if="userDatabases.length > 0" class="mb-4">
        <div class="text-sm font-medium mb-2">已授权的数据库:</div>
        <a-table
          :columns="[
            { title: '数据库', dataIndex: 'database', width: 150, align: 'center' },
            { title: '权限', slotName: 'privileges', align: 'center' },
            { title: '操作', slotName: 'actions', width: 100, align: 'center' }
          ]"
          :data="userDatabases"
          :pagination="false"
          size="small"
        >
          <template #privileges="{ record }">
            <a-space wrap>
              <a-tag v-for="priv in record.privileges" :key="priv" size="small">
                {{ priv }}
              </a-tag>
            </a-space>
          </template>
          <template #actions="{ record }">
            <a-popconfirm
              content="确定要撤销此数据库的所有权限吗？"
              @ok="handleRevokeGrant(record.database)"
            >
              <a-button type="outline" status="danger" size="small">撤销</a-button>
            </a-popconfirm>
          </template>
        </a-table>
      </div>

      <!-- 授予新权限 -->
      <div class="border-t pt-4">
        <div class="text-sm font-medium mb-2">授予新权限:</div>
        <a-form :model="grantForm" layout="vertical">
          <a-form-item label="选择数据库" required>
            <a-select v-model="grantForm.database" placeholder="请选择数据库">
              <a-option v-for="db in databases" :key="db.dbName" :value="db.dbName">
                {{ db.dbName }}
              </a-option>
            </a-select>
          </a-form-item>
          <a-form-item label="选择权限" required>
            <a-checkbox-group v-model="grantForm.privileges">
              <a-grid :cols="4" :col-gap="8" :row-gap="8">
                <a-grid-item v-for="opt in privilegeOptions" :key="opt.value">
                  <a-checkbox :value="opt.value">{{ opt.label }}</a-checkbox>
                </a-grid-item>
              </a-grid>
            </a-checkbox-group>
          </a-form-item>
        </a-form>
      </div>
    </a-modal>

    <InstallProgressModal :progress="installProgress" @close="closeInstallProgress" />
  </div>
</template>
