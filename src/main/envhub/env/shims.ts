import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shimsDir } from '../core/paths'
import { DetectedPlatform } from '../core/platform'

function winCmdShimBody(exePath: string, args: string[] = []): string {
  const quoted = `"${exePath}" ${args.join(' ')}`.trim()
  return `@echo off\r\n${quoted} %*\r\n`
}

function unixShimBody(exePath: string, args: string[] = []): string {
  const quoted = `'${exePath.replace(/'/g, "'\\''")}' ${args.join(' ')}`.trim()
  // eslint-disable-next-line no-useless-escape
  return `#!/usr/bin/env bash\nexec ${quoted} \"$@\"\n`
}

export interface ShimSpec {
  name: string // e.g. python, pip, node, npm, pnpm, psql, pg_ctl
  target: string // absolute path to executable
  args?: string[]
}

export function writeShims(dp: DetectedPlatform | string, specs: ShimSpec[]): void {
  const os = typeof dp === 'string' ? (dp.startsWith('win') ? 'win' : 'unix') : dp.os
  const dir = shimsDir()
  mkdirSync(dir, { recursive: true })
  for (const spec of specs) {
    if (os === 'win') {
      const body = winCmdShimBody(spec.target, spec.args)
      writeFileSync(join(dir, `${spec.name}.cmd`), body, 'utf8')
    } else {
      const body = unixShimBody(spec.target, spec.args)
      const p = join(dir, spec.name)
      writeFileSync(p, body, { encoding: 'utf8', mode: 0o755 })
    }
  }
}

export function removeShims(dp: DetectedPlatform, shimNames: string[]): void {
  const dir = shimsDir()
  for (const name of shimNames) {
    if (dp.os === 'win') {
      const p = join(dir, `${name}.cmd`)
      if (existsSync(p)) rmSync(p, { force: true })
    } else {
      const p = join(dir, name)
      if (existsSync(p)) rmSync(p, { force: true })
    }
  }
}
