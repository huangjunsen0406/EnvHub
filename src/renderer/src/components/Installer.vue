<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'

type Manifest = Record<string, unknown>

const state = reactive({
  bundleDir: '',
  manifest: null as Manifest | null,
  pythonVersion: '',
  nodeVersion: '',
  pgVersion: '',
  pgMajor: '',
  cluster: 'main',
  port: 5433,
  auth: 'scram' as 'scram' | 'md5',
  installPgVector: true,
  enableAutostart: true,
  createUserDb: false,
  newDb: 'appdb',
  newUser: 'app',
  newPass: '',
  wheelsRel: 'wheels',
  installPyTools: true,
  pnpmTgzRel: 'npm/pnpm.tgz',
  installPnpm: true
})

const logs = ref('')
let removeLogListener: (() => void) | null = null

function appendLog(line: string): void {
  logs.value += line + '\n'
}

async function loadManifest(): Promise<void> {
  if (!state.bundleDir) return
  try {
    const manifest = await window.electron.ipcRenderer.invoke('envhub:manifest:load', {
      bundleDir: state.bundleDir
    })
    state.manifest = manifest
    const pyVers = Object.keys(manifest.python || {})
    const nodeVers = Object.keys(manifest.node || {})
    const pgVers = Object.keys(manifest.pg || {})
    state.pythonVersion = state.pythonVersion || pyVers[0] || ''
    state.nodeVersion = state.nodeVersion || nodeVers[0] || ''
    state.pgVersion = state.pgVersion || pgVers[0] || ''
    state.pgMajor = state.pgMajor || state.pgVersion.split('.')[0] || ''
    appendLog('Manifest 已加载')
  } catch (e: unknown) {
    appendLog('加载 manifest 失败: ' + (e as Error).message)
  }
}

async function runInstall(): Promise<void> {
  if (!state.bundleDir) {
    appendLog('请先填写离线包目录')
    return
  }
  try {
    appendLog('开始安装...')
    await window.electron.ipcRenderer.invoke('envhub:installFromBundle', {
      bundleDir: state.bundleDir,
      python: state.pythonVersion || undefined,
      node: state.nodeVersion || undefined,
      pg: state.pgVersion || undefined
    })
    appendLog('核心组件安装完成')

    if (state.installPyTools && state.pythonVersion) {
      appendLog('安装 Python 工具（pipx/uv）...')
      await window.electron.ipcRenderer.invoke('envhub:python:installTools', {
        pythonVersion: state.pythonVersion,
        bundleDir: state.bundleDir,
        wheelsDirRelative: state.wheelsRel
      })
      appendLog('Python 工具安装完成')
    }

    if (state.installPnpm && state.nodeVersion) {
      appendLog('安装 pnpm ...')
      await window.electron.ipcRenderer.invoke('envhub:node:installPnpm', {
        nodeVersion: state.nodeVersion,
        bundleDir: state.bundleDir,
        pnpmTgzRelative: state.pnpmTgzRel
      })
      appendLog('pnpm 安装完成')
    }

    if (state.pgVersion) {
      appendLog('初始化并启动 PostgreSQL ...')
      const { dataDir, binDir } = await window.electron.ipcRenderer.invoke('envhub:pg:initStart', {
        pgVersion: state.pgVersion,
        cluster: state.cluster,
        port: state.port,
        auth: state.auth
      })
      if (state.installPgVector && state.pgMajor) {
        appendLog('安装 pgvector 扩展...')
        await window.electron.ipcRenderer.invoke('envhub:pg:installVector', {
          bundleDir: state.bundleDir,
          pgVersion: state.pgVersion,
          pgMajor: state.pgMajor
        })
        appendLog('pgvector 安装完成')
      }
      if (state.createUserDb && state.newUser && state.newDb) {
        appendLog('创建数据库与用户...')
        await window.electron.ipcRenderer.invoke('envhub:pg:createUserDb', {
          pgVersion: state.pgVersion,
          dbName: state.newDb,
          username: state.newUser,
          password: state.newPass || 'password123'
        })
        appendLog('数据库与用户创建完成')
      }
      if (state.enableAutostart) {
        appendLog('配置开机自启...')
        await window.electron.ipcRenderer.invoke('envhub:pg:enableAutostart', {
          pgVersion: state.pgVersion,
          cluster: state.cluster,
          dataDir,
          binDir,
          port: state.port
        })
        appendLog('开机自启已启用')
      }
    }
    appendLog('全部完成 ✅')
  } catch (e: unknown) {
    appendLog('安装失败: ' + (e as Error).message)
  }
}
onMounted(() => {
  const handler = (_: unknown, line: string): void => {
    appendLog(line)
  }
  window.electron.ipcRenderer.on('envhub:log', handler)
  removeLogListener = () => window.electron.ipcRenderer.removeListener('envhub:log', handler)
})

onBeforeUnmount(() => {
  if (removeLogListener) removeLogListener()
})
</script>

<template>
  <div class="installer">
    <h2>EnvHub 安装向导（离线）</h2>

    <div class="section">
      <label>离线包目录</label>
      <input v-model="state.bundleDir" placeholder="/path/to/bundle" />
      <button @click="loadManifest">加载清单</button>
    </div>

    <div v-if="state.manifest" class="section grid">
      <div>
        <label>Python 版本</label>
        <select v-model="state.pythonVersion">
          <option v-for="v in Object.keys(state.manifest.python || {})" :key="v" :value="v">
            {{ v }}
          </option>
        </select>
      </div>
      <div>
        <label>Node 版本</label>
        <select v-model="state.nodeVersion">
          <option v-for="v in Object.keys(state.manifest.node || {})" :key="v" :value="v">
            {{ v }}
          </option>
        </select>
      </div>
      <div>
        <label>PostgreSQL 版本</label>
        <select v-model="state.pgVersion" @change="state.pgMajor = state.pgVersion.split('.')[0]">
          <option v-for="v in Object.keys(state.manifest.pg || {})" :key="v" :value="v">
            {{ v }}
          </option>
        </select>
      </div>
      <div>
        <label>PG 主版本</label>
        <input v-model="state.pgMajor" />
      </div>
    </div>

    <div class="section grid">
      <div>
        <label>PG 集群名</label>
        <input v-model="state.cluster" />
      </div>
      <div>
        <label>端口</label>
        <input type="number" v-model.number="state.port" />
      </div>
      <div>
        <label>认证</label>
        <select v-model="state.auth">
          <option value="scram">scram</option>
          <option value="md5">md5</option>
        </select>
      </div>
    </div>

    <div class="section">
      <label
        ><input type="checkbox" v-model="state.installPyTools" /> 安装 pipx/uv（wheels
        相对目录）</label
      >
      <input v-model="state.wheelsRel" placeholder="wheels" />
    </div>

    <div class="section">
      <label><input type="checkbox" v-model="state.installPnpm" /> 安装 pnpm（tgz 相对路径）</label>
      <input v-model="state.pnpmTgzRel" placeholder="npm/pnpm.tgz" />
    </div>

    <div class="section">
      <label><input type="checkbox" v-model="state.installPgVector" /> 安装 pgvector</label>
    </div>

    <div class="section">
      <label><input type="checkbox" v-model="state.createUserDb" /> 创建数据库与用户</label>
      <div v-if="state.createUserDb" class="grid">
        <input v-model="state.newDb" placeholder="数据库名" />
        <input v-model="state.newUser" placeholder="用户名" />
        <input v-model="state.newPass" placeholder="密码(留空则默认)" />
      </div>
    </div>

    <div class="section">
      <label><input type="checkbox" v-model="state.enableAutostart" /> 开机自启</label>
    </div>

    <div class="section">
      <button @click="runInstall">一键安装</button>
    </div>

    <div class="section">
      <label>日志输出</label>
      <textarea class="logs" readonly :value="logs"></textarea>
    </div>
  </div>
</template>

<style scoped>
.installer {
  max-width: 900px;
  margin: 24px auto;
  padding: 12px;
}
.section {
  margin: 12px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
input,
select {
  width: 100%;
  padding: 6px;
}
button {
  padding: 6px 12px;
}
.logs {
  width: 100%;
  height: 240px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
label {
  display: block;
  margin-bottom: 6px;
}
</style>
