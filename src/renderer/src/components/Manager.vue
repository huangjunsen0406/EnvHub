<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'

type Tool = 'python' | 'node' | 'pg'

const tabs: { key: Tool; name: string; desc: string }[] = [
  { key: 'python', name: 'Python', desc: '多版本 Python 运行时与包管理' },
  { key: 'node', name: 'Node.js', desc: '多版本 Node 与前端工具链' },
  { key: 'pg', name: 'PostgreSQL', desc: '数据库内核与扩展（pgvector）' }
]

const state = reactive({
  tab: 'python' as Tool,
  bundleDir: '',
  manifest: null as unknown,
  installed: { python: [], node: [], pg: [], current: {} as Record<string, string> } as any,
  wheelsRel: 'wheels',
  pnpmTgzRel: 'npm/pnpm.tgz',
  cluster: 'main',
  port: 5433
})

const logs = ref('')
function log(line: string): void {
  logs.value += line + '\n'
}

async function refreshInstalled(): Promise<void> {
  const res = await window.electron.ipcRenderer.invoke('envhub:installed:list')
  state.installed = res
}

async function loadManifest(): Promise<void> {
  if (!state.bundleDir) return
  state.manifest = await window.electron.ipcRenderer.invoke('envhub:manifest:load', {
    bundleDir: state.bundleDir
  })
  await refreshInstalled()
}

function versionsOf(tool: Tool): string[] {
  if (!state.manifest || !state.manifest[tool]) return []
  return Object.keys(state.manifest[tool])
}

function isInstalled(tool: Tool, v: string): boolean {
  return (state.installed[tool] || []).some((x: { version: string }) => x.version === v)
}

function isCurrent(tool: Tool, v: string): boolean {
  return state.installed.current?.[tool] === v
}

async function install(tool: Tool, v: string): Promise<void> {
  if (!state.bundleDir) {
    log('请先设置离线包目录')
    return
  }
  await window.electron.ipcRenderer.invoke('envhub:install:one', {
    bundleDir: state.bundleDir,
    tool,
    version: v
  })
  log(`${tool} ${v} 安装完成`)
  await refreshInstalled()
}

async function useVer(tool: Tool, v: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('envhub:use', { tool, version: v })
  log(`${tool} 已切换到 ${v}`)
  await refreshInstalled()
}

async function uninstall(tool: Tool, v: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('envhub:uninstall', { tool, version: v })
  log(`${tool} ${v} 已卸载`)
  await refreshInstalled()
}

// 工具快捷操作
async function installPyTools(v: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('envhub:python:installTools', {
    pythonVersion: v,
    bundleDir: state.bundleDir,
    wheelsDirRelative: state.wheelsRel
  })
  log(`已为 Python ${v} 安装 pipx/uv`)
}

async function installPnpm(v: string): Promise<void> {
  await window.electron.ipcRenderer.invoke('envhub:node:installPnpm', {
    nodeVersion: v,
    bundleDir: state.bundleDir,
    pnpmTgzRelative: state.pnpmTgzRel
  })
  log(`已为 Node ${v} 安装 pnpm`)
}

async function pgInitStart(v: string): Promise<void> {
  const { dataDir } = await window.electron.ipcRenderer.invoke('envhub:pg:initStart', {
    pgVersion: v,
    cluster: state.cluster,
    port: state.port,
    auth: 'scram'
  })
  log(`PostgreSQL ${v} 已初始化并启动：${dataDir}`)
}

async function installPgVector(v: string): Promise<void> {
  const pgMajor = v.split('.')[0]
  await window.electron.ipcRenderer.invoke('envhub:pg:installVector', {
    bundleDir: state.bundleDir,
    pgVersion: v,
    pgMajor
  })
  log(`已为 PostgreSQL ${v} 安装 pgvector`)
}

let removeLogListener: (() => void) | null = null

onMounted(() => {
  refreshInstalled()
  const handler = (_: unknown, line: string): void => log(line)
  window.electron.ipcRenderer.on('envhub:log', handler)
  removeLogListener = () => window.electron.ipcRenderer.removeListener('envhub:log', handler)
})

onBeforeUnmount(() => {
  if (removeLogListener) removeLogListener()
})
</script>

<template>
  <div class="manager">
    <header class="bar">
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="{ active: state.tab === t.key }"
          @click="state.tab = t.key"
        >
          {{ t.name }}
        </button>
      </div>
      <div class="bundle">
        <input v-model="state.bundleDir" placeholder="离线包目录（含 manifest.json）" />
        <button @click="loadManifest">加载清单</button>
      </div>
    </header>

    <section v-if="state.tab === 'python'" class="tool-panel">
      <h3>Python 版本</h3>
      <div class="list">
        <div class="row head">
          <div>版本</div>
          <div>状态</div>
          <div>操作</div>
          <div>工具</div>
        </div>
        <div v-for="v in versionsOf('python')" :key="v" class="row">
          <div>{{ v }}</div>
          <div>
            <span v-if="isInstalled('python', v)">已安装</span>
            <span v-else>未安装</span>
            <span v-if="isCurrent('python', v)" class="tag">当前</span>
          </div>
          <div class="ops">
            <button v-if="!isInstalled('python', v)" @click="install('python', v)">安装</button>
            <button
              v-if="isInstalled('python', v) && !isCurrent('python', v)"
              @click="useVer('python', v)"
            >
              设为当前
            </button>
            <button v-if="isInstalled('python', v)" @click="uninstall('python', v)">卸载</button>
          </div>
          <div class="ops">
            <button v-if="isInstalled('python', v)" @click="installPyTools(v)">安装 pipx/uv</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="state.tab === 'node'" class="tool-panel">
      <h3>Node.js 版本</h3>
      <div class="list">
        <div class="row head">
          <div>版本</div>
          <div>状态</div>
          <div>操作</div>
          <div>工具</div>
        </div>
        <div v-for="v in versionsOf('node')" :key="v" class="row">
          <div>{{ v }}</div>
          <div>
            <span v-if="isInstalled('node', v)">已安装</span>
            <span v-else>未安装</span>
            <span v-if="isCurrent('node', v)" class="tag">当前</span>
          </div>
          <div class="ops">
            <button v-if="!isInstalled('node', v)" @click="install('node', v)">安装</button>
            <button
              v-if="isInstalled('node', v) && !isCurrent('node', v)"
              @click="useVer('node', v)"
            >
              设为当前
            </button>
            <button v-if="isInstalled('node', v)" @click="uninstall('node', v)">卸载</button>
          </div>
          <div class="ops">
            <button v-if="isInstalled('node', v)" @click="installPnpm(v)">安装 pnpm</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="state.tab === 'pg'" class="tool-panel">
      <h3>PostgreSQL 版本</h3>
      <div class="hints">
        集群名 <input v-model="state.cluster" style="width: 120px" /> 端口
        <input v-model.number="state.port" type="number" style="width: 100px" />
      </div>
      <div class="list">
        <div class="row head">
          <div>版本</div>
          <div>状态</div>
          <div>操作</div>
          <div>扩展</div>
        </div>
        <div v-for="v in versionsOf('pg')" :key="v" class="row">
          <div>{{ v }}</div>
          <div>
            <span v-if="isInstalled('pg', v)">已安装</span>
            <span v-else>未安装</span>
            <span v-if="isCurrent('pg', v)" class="tag">当前</span>
          </div>
          <div class="ops">
            <button v-if="!isInstalled('pg', v)" @click="install('pg', v)">安装</button>
            <button v-if="isInstalled('pg', v) && !isCurrent('pg', v)" @click="useVer('pg', v)">
              设为当前
            </button>
            <button v-if="isInstalled('pg', v)" @click="uninstall('pg', v)">卸载</button>
            <button v-if="isInstalled('pg', v)" @click="pgInitStart(v)">初始化并启动</button>
          </div>
          <div class="ops">
            <button v-if="isInstalled('pg', v)" @click="installPgVector(v)">安装 pgvector</button>
          </div>
        </div>
      </div>
    </section>

    <section class="logs">
      <h3>日志</h3>
      <textarea readonly :value="logs"></textarea>
    </section>
  </div>
</template>

<style scoped>
.manager {
  max-width: 1000px;
  margin: 0 auto;
  padding: 16px;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tabs button {
  margin-right: 8px;
  padding: 6px 10px;
}
.tabs .active {
  background: #3a7afe;
  color: #fff;
}
.bundle input {
  width: 360px;
  padding: 6px;
}
.bundle button {
  margin-left: 8px;
}
.tool-panel {
  margin-top: 16px;
}
.list {
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr 2fr;
  gap: 8px;
  padding: 8px 10px;
  align-items: center;
  border-top: 1px solid #f0f0f0;
}
.row.head {
  background: #fafafa;
  font-weight: bold;
  border-top: 0;
}
.ops button {
  margin-right: 8px;
}
.tag {
  background: #00b894;
  color: #fff;
  border-radius: 3px;
  padding: 2px 6px;
  margin-left: 8px;
  font-size: 12px;
}
.logs textarea {
  width: 100%;
  height: 160px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hints {
  margin: 8px 0;
}
</style>
