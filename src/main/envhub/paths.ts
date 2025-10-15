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

export function bundlesManifestPath(bundleDir: string): string {
  return join(bundleDir, 'manifest.json')
}

export function redisDataDir(majorVersion: string, cluster: string): string {
  return join(envhubRoot(), 'data', 'redis', majorVersion, cluster)
}

export function redisLogDir(majorVersion: string, cluster: string): string {
  return join(envhubRoot(), 'logs', 'redis', majorVersion, cluster)
}
