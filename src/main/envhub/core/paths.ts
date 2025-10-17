import { homedir } from 'os'
import { join } from 'path'

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
  tool: 'python' | 'node' | 'pg' | 'java' | 'redis' | 'mysql',
  version: string
): string {
  // 简化路径结构，去掉架构层级
  // 原来：~/.envhub/toolchains/mysql/9.1.0/darwin-arm64/
  // 现在：~/.envhub/toolchains/mysql/9.1.0/
  return join(envhubRoot(), 'toolchains', tool, version)
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

export function mysqlDataDir(version: string, cluster: string): string {
  return join(envhubRoot(), 'mysql', version, cluster)
}

export function mysqlLogDir(version: string, cluster: string): string {
  return join(envhubRoot(), 'logs', 'mysql', version, cluster)
}
