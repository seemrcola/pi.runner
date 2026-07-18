import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createTemporaryDirectoryTracker() {
  const directories: string[] = []
  return {
    create(prefix: string): string {
      const directory = mkdtempSync(join(tmpdir(), prefix))
      directories.push(directory)
      return directory
    },
    cleanup(): void {
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
}
