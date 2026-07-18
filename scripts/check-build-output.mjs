import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const required = [
  'dist/renderer/index.html',
  'dist/electron/main.js',
  'dist/electron/petPreload.mjs',
  'dist/electron/preload.mjs',
  'dist/backend/backend/server.js',
]

const forbidden = ['dist-backend', 'dist-electron']

const missing = required.filter((path) => !existsSync(join(root, path)))
const presentForbidden = forbidden.filter((path) => existsSync(join(root, path)))
const compiledTests = collectFiles(join(root, 'dist')).filter((path) => /\.test\.js(?:\.map)?$/.test(path))

if (missing.length > 0 || presentForbidden.length > 0 || compiledTests.length > 0) {
  for (const path of missing) {
    console.error(`Missing expected build output: ${path}`)
  }
  for (const path of presentForbidden) {
    console.error(`Unexpected build output: ${path}`)
  }
  for (const path of compiledTests) {
    console.error(`Unexpected compiled test output: ${path}`)
  }
  process.exit(1)
}

function collectFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}
