import { readFileSync } from 'fs'
import { join } from 'path'
import { PlatformKey } from './platform'

export type ToolKey = 'python' | 'node' | 'pg' | 'pgvector'

export interface ArtifactRef {
  file: string
  sha256: string
}

export interface Manifest {
  python?: Record<string, Partial<Record<PlatformKey, ArtifactRef>>>
  node?: Record<string, Partial<Record<PlatformKey, ArtifactRef>>>
  pg?: Record<string, Partial<Record<PlatformKey, ArtifactRef>>>
  pgvector?: Record<string, Partial<Record<PlatformKey, ArtifactRef>>> // keyed by pg major ("16")
}

export function loadManifest(manifestPath: string): Manifest {
  const raw = readFileSync(manifestPath, 'utf8')
  return JSON.parse(raw) as Manifest
}

export function selectArtifact(
  manifest: Manifest,
  tool: ToolKey,
  versionOrPgMajor: string,
  platformKey: PlatformKey
): ArtifactRef {
  const table = manifest[tool]
  if (!table) throw new Error(`Manifest missing section: ${tool}`)
  const byVersion = table[versionOrPgMajor]
  if (!byVersion) throw new Error(`Manifest missing ${tool}@${versionOrPgMajor}`)
  const entry = byVersion[platformKey]
  if (!entry) throw new Error(`Manifest missing ${tool}@${versionOrPgMajor} for ${platformKey}`)
  return entry
}

export function resolveArtifactPath(bundleDir: string, artifact: ArtifactRef): string {
  return join(bundleDir, artifact.file)
}
