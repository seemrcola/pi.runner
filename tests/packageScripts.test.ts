import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  scripts?: Record<string, string>
  build?: {
    appId?: string
    productName?: string
    directories?: { output?: string; buildResources?: string }
    files?: string[]
    mac?: { target?: Array<string | { target: string; arch?: string[] }>; icon?: string }
  }
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest

describe('package scripts', () => {
  it('defines separate verification, build and packaging commands', () => {
    expect(manifest.scripts).toMatchObject({
      clean: 'node scripts/clean-build-output.mjs',
      typecheck: 'vue-tsc -b && tsc -p tsconfig.backend.json --noEmit',
      build: 'npm run clean && vue-tsc -b && vite build && tsc -p tsconfig.backend.json && npm run check:build-output',
      verify: 'npm run typecheck && npm test',
      'package:dir': 'npm run build && electron-builder --dir',
      package: 'npm run build && electron-builder --mac dmg zip --arm64',
    })
    expect(manifest.scripts).not.toHaveProperty('package:mac')
  })

  it('packages only the production runtime into a dedicated release directory', () => {
    expect(manifest.build).toMatchObject({
      appId: 'com.pi.runner',
      productName: 'Pi Runner',
      directories: {
        output: 'release',
        buildResources: 'public',
      },
      files: ['dist/**/*', 'package.json'],
      mac: {
        icon: 'public/app-icon.png',
      },
    })
  })
})
