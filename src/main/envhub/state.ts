import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { envhubRoot, toolchainRoot } from './paths'
import { DetectedPlatform } from './platform'
import { writeShims, removeShims } from './shims'

export type Tool = 'python' | 'node' | 'pg'

interface CurrentState {
  current?: Partial<Record<Tool, string>>
}

function currentStatePath(): string {
  return join(envhubRoot(), 'current.json')
}

export function getCurrent(): CurrentState {
  try {
    const p = currentStatePath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as CurrentState
  } catch {}
  return { current: {} }
}

export function setCurrent(tool: Tool, version: string): void {
  const state = getCurrent()
  state.current = state.current || {}
  if (version === '') {
    delete state.current[tool]
  } else {
    state.current[tool] = version
  }
  mkdirSync(envhubRoot(), { recursive: true })
  writeFileSync(currentStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

export function listInstalled(
  tool: Tool,
  dp: DetectedPlatform
): { version: string; path: string }[] {
  const base = join(envhubRoot(), 'toolchains', tool)
  try {
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const items: { version: string; path: string }[] = []
    for (const v of versions) {
      const p = toolchainRoot(tool, v, dp)
      if (existsSync(p)) items.push({ version: v, path: p })
    }
    return items
  } catch {
    return []
  }
}

export function uninstallTool(tool: Tool, version: string, dp: DetectedPlatform): void {
  const p = toolchainRoot(tool, version, dp)
  if (existsSync(p)) rmSync(p, { recursive: true, force: true })
}

export function updateShimsForTool(tool: Tool, version: string, dp: DetectedPlatform): void {
  // If version is empty, remove shims
  if (version === '') {
    if (tool === 'python') {
      removeShims(dp, ['python', 'pip'])
    } else if (tool === 'node') {
      removeShims(dp, ['node', 'npm'])
    } else if (tool === 'pg') {
      removeShims(dp, ['psql', 'pg_ctl', 'postgres'])
    }
    setCurrent(tool, '')
    return
  }

  // Create shims for the specified version
  const base = toolchainRoot(tool, version, dp)
  if (tool === 'python') {
    const python =
      process.platform === 'win32' ? join(base, 'python.exe') : join(base, 'bin', 'python')
    writeShims(dp, [
      { name: 'python', target: python },
      { name: 'pip', target: python, args: ['-m', 'pip'] }
    ])
  } else if (tool === 'node') {
    const node = process.platform === 'win32' ? join(base, 'node.exe') : join(base, 'bin', 'node')
    const npm = process.platform === 'win32' ? join(base, 'npm.cmd') : join(base, 'bin', 'npm')
    writeShims(dp, [
      { name: 'node', target: node },
      { name: 'npm', target: npm }
    ])
  } else if (tool === 'pg') {
    const binDir = join(base, 'bin')
    const psql = process.platform === 'win32' ? join(binDir, 'psql.exe') : join(binDir, 'psql')
    const pgctl = process.platform === 'win32' ? join(binDir, 'pg_ctl.exe') : join(binDir, 'pg_ctl')
    const postgres =
      process.platform === 'win32' ? join(binDir, 'postgres.exe') : join(binDir, 'postgres')
    writeShims(dp, [
      { name: 'psql', target: psql },
      { name: 'pg_ctl', target: pgctl },
      { name: 'postgres', target: postgres }
    ])
  }
  setCurrent(tool, version)
}
