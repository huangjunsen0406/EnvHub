import { homedir } from 'os'
import { join } from 'path'
import { DetectedPlatform } from './platform'

export function getHomeDir(): string {
  return homedir()
}

export function envhubRoot(): string {
  return join(getHomeDir(), '.envhub')
}

export function shimsDir(): string {
  return join(envhubRoot(), 'shims')
}

export function toolchainRoot(
  tool: 'python' | 'node' | 'pg' | 'java' | 'redis',
  version: string,
  dp: DetectedPlatform | string
): string {
  const platformKey = typeof dp === 'string' ? dp : dp.platformKey
  return join(envhubRoot(), 'toolchains', tool, version, platformKey)
}

export function pgDataDir(pgVersion: string, cluster: string): string {
  return join(envhubRoot(), 'pg', pgVersion, cluster)
}

export function logsDir(): string {
  return join(envhubRoot(), 'logs')
}

export function redisDataDir(version: string, cluster: string): string {
  return join(envhubRoot(), 'data', 'redis', version, cluster)
}

export function redisLogDir(version: string, cluster: string): string {
  return join(envhubRoot(), 'logs', 'redis', version, cluster)
}
