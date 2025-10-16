<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconPlus, IconRefresh } from '@arco-design/web-vue/es/icon'
import { useLogsStore } from '../../../../store/logs'

const props = defineProps<{
  version: string
}>()

const currentDb = ref(0)
const keys = ref<Array<{ name: string; type: string; ttl: number; size: number }>>([])
const loading = ref(false)
const searchText = ref('')
const showAddModal = ref(false)
const showEditModal = ref(false)
const selectedKey = ref<{ name: string; value: string; type: string; ttl: number } | null>(null)
const maxDatabases = ref(16) // 默认16个数据库

// 新增键表单
const addForm = ref({
  db: 0,
  key: '',
  value: '',
  type: 'string' as 'string' | 'hash' | 'list' | 'set' | 'zset',
  ttl: 0
})

// 编辑键表单
const editForm = ref({
  db: 0,
  key: '',
  value: '',
  type: 'string' as 'string' | 'hash' | 'list' | 'set' | 'zset',
  ttl: 0
})

const columns = [
  { title: '键', dataIndex: 'name', width: 250, ellipsis: true },
  { title: '值', slotName: 'value', width: 200, ellipsis: true },
  { title: '数据类型', dataIndex: 'type', width: 100 },
  { title: '数据长度', dataIndex: 'size', width: 100 },
  { title: '有效期', slotName: 'ttl', width: 120 },
  { title: '操作', slotName: 'actions', width: 150, fixed: 'right' }
]

// 数据库标签
const dbTabs = computed(() => {
  return Array.from({ length: maxDatabases.value }, (_, i) => ({
    db: i,
    count: i === currentDb.value ? keys.value.length : 0
  }))
})

// 过滤后的键列表
const filteredKeys = computed(() => {
  if (!searchText.value) return keys.value
  return keys.value.filter((k) => k.name.includes(searchText.value))
})

// 切换数据库
async function selectDb(db: number): Promise<void> {
  currentDb.value = db
  await loadKeys()
}

// 加载键列表
async function loadKeys(): Promise<void> {
  try {
    loading.value = true
    const result = await window.electron.ipcRenderer.invoke('envhub:redis:keys', {
      version: props.version,
      db: currentDb.value,
      pattern: '*'
    })
    keys.value = result.keys || []
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`加载失败: ${message}`)
  } finally {
    loading.value = false
  }
}

// 加载配置并获取数据库数量
async function loadConfig(): Promise<void> {
  try {
    const configResult = await window.electron.ipcRenderer.invoke('envhub:redis:getConfig', {
      version: props.version
    })
    if (configResult.ok && configResult.config.databases) {
      maxDatabases.value = configResult.config.databases
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const logsStore = useLogsStore()
    logsStore.addLog(`无法获取数据库配置，使用默认值16: ${message}`, 'warn')
  }
}

// 打开添加键对话框
function openAddModal(): void {
  addForm.value = {
    db: currentDb.value,
    key: '',
    value: '',
    type: 'string',
    ttl: 0
  }
  showAddModal.value = true
}

// 添加键
async function handleAddKey(): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:set', {
      version: props.version,
      db: addForm.value.db,
      key: addForm.value.key,
      value: addForm.value.value,
      type: addForm.value.type,
      ttl: addForm.value.ttl
    })
    Message.success('添加成功')
    showAddModal.value = false
    await loadKeys()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`添加失败: ${message}`)
  }
}

// 打开编辑对话框
async function openEditModal(keyName: string): Promise<void> {
  try {
    const result = await window.electron.ipcRenderer.invoke('envhub:redis:get', {
      version: props.version,
      db: currentDb.value,
      key: keyName
    })
    selectedKey.value = result
    editForm.value = {
      db: currentDb.value,
      key: result.name,
      value: result.value,
      type: result.type,
      ttl: result.ttl
    }
    showEditModal.value = true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`获取键详情失败: ${message}`)
  }
}

// 编辑键
async function handleEditKey(): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:set', {
      version: props.version,
      db: editForm.value.db,
      key: editForm.value.key,
      value: editForm.value.value,
      type: editForm.value.type,
      ttl: editForm.value.ttl
    })
    Message.success('更新成功')
    showEditModal.value = false
    await loadKeys()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`更新失败: ${message}`)
  }
}

// 删除键
async function handleDeleteKey(keyName: string): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('envhub:redis:del', {
      version: props.version,
      db: currentDb.value,
      key: keyName
    })
    Message.success('删除成功')
    await loadKeys()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    Message.error(`删除失败: ${message}`)
  }
}

// 根据数据类型返回输入提示
function getPlaceholderByType(type: string): string {
  const placeholders = {
    string: '请输入字符串值',
    hash: '格式：field1 value1 field2 value2\n例如：name John age 30',
    list: '格式：value1 value2 value3\n例如：apple banana orange',
    set: '格式：member1 member2 member3\n例如：red blue green',
    zset: '格式：score1 member1 score2 member2\n例如：100 Alice 90 Bob'
  }
  return placeholders[type] || '请输入值'
}

onMounted(async () => {
  if (props.version) {
    await loadConfig()
    await loadKeys()
  }
})
</script>

<template>
  <div class="w-full">
    <!-- 数据库选择标签 -->
    <div class="mb-4 flex items-center gap-2 overflow-x-auto pb-2">
      <a-button
        v-for="tab in dbTabs"
        :key="tab.db"
        :type="currentDb === tab.db ? 'primary' : 'outline'"
        size="small"
        @click="selectDb(tab.db)"
      >
        DB{{ tab.db }} [{{ tab.count }}]
      </a-button>
    </div>

    <!-- 操作栏 -->
    <div class="mb-4 flex items-center gap-2">
      <a-button type="primary" size="small" @click="openAddModal">
        <template #icon>
          <icon-plus />
        </template>
        添加Key
      </a-button>
      <a-button type="outline" size="small" :loading="loading" @click="loadKeys">
        <template #icon>
          <icon-refresh />
        </template>
        刷新
      </a-button>
      <a-input-search
        v-model="searchText"
        placeholder="请输入键名称"
        style="width: 300px"
        size="small"
      />
    </div>

    <!-- 键列表表格 -->
    <a-table
      :columns="columns"
      :data="filteredKeys"
      :loading="loading"
      :pagination="{ pageSize: 20, showTotal: true }"
      :bordered="true"
    >
      <template #value="{ record }">
        <div class="truncate" :title="String(record.value)">
          {{ String(record.value).substring(0, 100) }}
        </div>
      </template>
      <template #ttl="{ record }">
        <a-tag v-if="record.ttl === -1" color="green">永久</a-tag>
        <span v-else>{{ record.ttl }}秒</span>
      </template>
      <template #actions="{ record }">
        <a-space>
          <a-button type="text" size="small" @click="openEditModal(record.name)"> 编辑 </a-button>
          <a-popconfirm content="确定要删除此键吗？" @ok="handleDeleteKey(record.name)">
            <a-button type="text" status="danger" size="small"> 删除 </a-button>
          </a-popconfirm>
        </a-space>
      </template>
    </a-table>

    <!-- 添加键对话框 -->
    <a-modal
      v-model:visible="showAddModal"
      title="添加redis数据库"
      @ok="handleAddKey"
      @cancel="showAddModal = false"
    >
      <a-form :model="addForm">
        <a-form-item label="数据库" required>
          <a-select v-model="addForm.db" disabled>
            <a-option :value="currentDb">DB{{ currentDb }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="数据类型" required>
          <a-select v-model="addForm.type" placeholder="选择数据类型">
            <a-option value="string">String</a-option>
            <a-option value="hash">Hash</a-option>
            <a-option value="list">List</a-option>
            <a-option value="set">Set</a-option>
            <a-option value="zset">Sorted Set</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="键" required>
          <a-input v-model="addForm.key" placeholder="请输入键名" />
        </a-form-item>
        <a-form-item label="值" required>
          <a-textarea
            v-model="addForm.value"
            :placeholder="getPlaceholderByType(addForm.type)"
            :auto-size="{ minRows: 3, maxRows: 10 }"
          />
        </a-form-item>
        <a-form-item label="有效期">
          <a-input-number v-model="addForm.ttl" placeholder="为空则永不过期">
            <template #suffix>秒</template>
          </a-input-number>
          <div class="mt-1 text-xs text-gray-500">有效期为0表示永久</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 编辑键对话框 -->
    <a-modal
      v-model:visible="showEditModal"
      title="编辑redis数据库"
      @ok="handleEditKey"
      @cancel="showEditModal = false"
    >
      <a-form :model="editForm">
        <a-form-item label="数据库" required>
          <a-select v-model="editForm.db" disabled>
            <a-option :value="currentDb">DB{{ currentDb }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="数据类型" required>
          <a-input v-model="editForm.type" disabled />
        </a-form-item>
        <a-form-item label="键" required>
          <a-input v-model="editForm.key" disabled />
        </a-form-item>
        <a-form-item label="值" required>
          <a-textarea
            v-model="editForm.value"
            placeholder="请输入值"
            :auto-size="{ minRows: 3, maxRows: 10 }"
          />
        </a-form-item>
        <a-form-item label="有效期">
          <a-input-number v-model="editForm.ttl" placeholder="为空则永不过期">
            <template #suffix>秒</template>
          </a-input-number>
          <div class="mt-1 text-xs text-gray-500">有效期为0表示永久</div>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>
