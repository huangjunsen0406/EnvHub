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
  tool: 'python' | 'node' | 'pg' | 'java',
  version: string,
  dp: DetectedPlatform
): string {
  return join(envhubRoot(), 'toolchains', tool, version, dp.platformKey)
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
