import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { ArtifactRef } from './manifest'
import { extractArchive, removeQuarantineAttr } from './extract'

export interface PgVectorInstallOptions {
  bundleDir: string
  artifact: ArtifactRef
  pgRootDir: string // the unpacked PG root with lib/ and share/extension/
}

// Expects the archive to contain lib/vector.(dll|so) and share/extension/* files
export async function installPgVector(opts: PgVectorInstallOptions): Promise<void> {
  const temp = join(opts.pgRootDir, '.tmp-pgvector')
  mkdirSync(temp, { recursive: true })
  await extractArchive(join(opts.bundleDir, opts.artifact.file), temp)
  await removeQuarantineAttr(temp)

  const libSrc = join(temp, 'lib')
  const extSrc = join(temp, 'share', 'extension')
  const libDst = join(opts.pgRootDir, 'lib')
  const extDst = join(opts.pgRootDir, 'share', 'extension')
  mkdirSync(libDst, { recursive: true })
  mkdirSync(extDst, { recursive: true })

  // Shallow copy expected files
  for (const f of readdirSync(libSrc)) {
    if (
      f.startsWith('vector.') ||
      f === 'vector.so' ||
      f === 'vector.dll' ||
      f === 'vector.dylib'
    ) {
      copyFileSync(join(libSrc, f), join(libDst, f))
    }
  }
  for (const f of readdirSync(extSrc)) {
    if (f.startsWith('vector')) {
      copyFileSync(join(extSrc, f), join(extDst, f))
    }
  }
}
