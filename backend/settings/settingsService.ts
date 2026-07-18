import { access, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { PiSettingsConfigFile, PiSettingsSnapshot, PiSkillInfo } from '../../shared/protocol.js'
import { terminateChildProcess } from '../process/processTree.js'
import { refreshPiProcessEnv, resolvePiExecutable } from '../pi/cli.js'

const installCommand = 'installer=$(curl -fsSL https://pi.dev/install.sh) && test -n "$installer" && printf "%s\n" "$installer" | sh'

export type SettingsServiceOptions = {
  agentDir?: string
  cwd?: string
  piExecutablePath?: string
  shell?: string
  userSkillsDir?: string
  spawnProcess?: typeof spawn
}

type PiSdkSkill = {
  name?: unknown
  description?: unknown
  filePath?: unknown
}

type PiSdkResourceLoader = {
  reload(): Promise<void>
  getSkills(): { skills?: PiSdkSkill[] }
}

type PiSdkModule = {
  DefaultResourceLoader?: new (options: { cwd: string; agentDir: string }) => PiSdkResourceLoader
}

export function createSettingsService(options: SettingsServiceOptions = {}) {
  const agentDir = options.agentDir ?? join(homedir(), '.pi', 'agent')
  const cwd = options.cwd ?? process.cwd()
  const piExecutablePath = options.piExecutablePath
  const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh'
  const userSkillsDir = options.userSkillsDir ?? join(homedir(), '.agents', 'skills')
  const spawnProcess = options.spawnProcess ?? spawn
  const modelsPath = join(agentDir, 'models.json')
  const settingsPath = join(agentDir, 'settings.json')
  let lastInstall: PiSettingsSnapshot['install'] = { phase: 'idle' }
  let installProcess: ChildProcessWithoutNullStreams | null = null
  let shuttingDown = false

  async function snapshot(): Promise<PiSettingsSnapshot> {
    const [pi, models, settings, skills] = await Promise.all([
      checkPiInstalled(shell, piExecutablePath),
      readJsonConfigFile(modelsPath),
      readJsonConfigFile(settingsPath),
      discoverSkills({ agentDir, cwd, shell, piExecutablePath, userSkillsDir }),
    ])

    return {
      pi,
      models,
      settings,
      skills,
      install: lastInstall,
    }
  }

  async function saveModels(content: string): Promise<PiSettingsSnapshot> {
    await saveJsonConfigFile(modelsPath, 'models.json', content)
    return snapshot()
  }

  async function saveSettings(content: string): Promise<PiSettingsSnapshot> {
    await saveJsonConfigFile(settingsPath, 'settings.json', content)
    return snapshot()
  }

  async function saveAll(models: string, settings: string): Promise<PiSettingsSnapshot> {
    // 两份配置先共同校验并暂存；提交中任一步失败时恢复原文件，避免只保存成功一份。
    const formattedModels = formatJsonConfig('models.json', models)
    const formattedSettings = formatJsonConfig('settings.json', settings)
    await writeFormattedJsonConfigsAtomically([
      { configPath: modelsPath, formatted: formattedModels },
      { configPath: settingsPath, formatted: formattedSettings },
    ])
    return snapshot()
  }

  async function installPi(): Promise<PiSettingsSnapshot> {
    if (shuttingDown) throw new Error('Backend 正在退出，无法启动 Pi 安装')
    if (installProcess) throw new Error('Pi 安装进程已经在运行')
    lastInstall = { phase: 'running' }
    try {
      // MVP 当前只考虑 mac 用户，安装命令按 Pi 官方 shell installer 执行；Windows 兼容后续单独收口。
      const result = await runInstaller(shell, spawnProcess, (child) => { installProcess = child })
      lastInstall = {
        phase: 'succeeded',
        output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
      }
      // 安装器可能更新 shell 配置和 PATH；后续 snapshot/runner 必须重新读取环境。
      refreshPiProcessEnv(shell)
    } catch (error) {
      const output = outputFromExecError(error)
      lastInstall = {
        phase: 'failed',
        ...(output ? { output } : {}),
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return snapshot()
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true
    const child = installProcess
    if (!child) return
    await terminateInstallerProcess(child)
  }

  return {
    snapshot,
    saveModels,
    saveSettings,
    saveAll,
    installPi,
    shutdown,
  }
}

async function runInstaller(
  shell: string,
  spawnProcess: typeof spawn,
  onSpawn: (child: ChildProcessWithoutNullStreams | null) => void,
): Promise<{ stdout: string; stderr: string }> {
  const child = spawnProcess(shell, ['-lc', installCommand], {
    shell: false,
  })
  onSpawn(child)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let outputBytes = 0
  let terminationReason: Error | null = null

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => requestTermination(new Error('Pi 安装超时（120 秒）')), 120_000)

    const finish = (error?: Error, releaseProcess = true) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 只有 root/后代均确认退出时才释放受管 handle。终止校验失败后保留它，
      // 阻止同一 backend 再启动第二个 installer；最终由 Electron process group 收敛。
      if (releaseProcess) onSpawn(null)
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      }
      if (error) {
        reject(Object.assign(error, result))
      } else {
        resolve(result)
      }
    }
    const requestTermination = (error: Error) => {
      if (terminationReason) return
      terminationReason = error
      void terminateInstallerProcess(child).then(
        () => finish(error),
        (terminationError) => {
          finish(new AggregateError([error, terminationError], 'Pi 安装进程终止失败'), false)
        },
      )
    }
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > 1024 * 1024) {
        requestTermination(new Error('Pi 安装输出超过 1MB 限制'))
        return
      }
      target.push(chunk)
    }

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.once('error', (error) => finish(error))
    child.once('close', (code, signal) => {
      // 主动终止路径必须等待 terminateChildProcess 同时核验后代；root close 本身
      // 不能证明 curl/sh 等后代已经消失。
      if (terminationReason) return
      if (code === 0) {
        finish()
      } else {
        finish(new Error(`Pi 安装进程退出 code=${code ?? 0} signal=${signal ?? ''}`))
      }
    })
  })
}

async function terminateInstallerProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  await terminateChildProcess(child, {
    graceMs: 2_000,
    forceWaitMs: 2_000,
    // Installer shell 只是包装层，优先通知整棵 curl/sh 后代，避免 shell 先退出后 PPID 关系丢失。
    terminateDescendantsFirst: true,
  })
}

async function checkPiInstalled(shell: string, piExecutablePath?: string): Promise<PiSettingsSnapshot['pi']> {
  if (piExecutablePath?.trim()) {
    return { installed: true, executablePath: piExecutablePath.trim() }
  }

  try {
    return { installed: true, executablePath: await resolvePiExecutable(shell) }
  } catch {
    return { installed: false }
  }
}

async function readJsonConfigFile(configPath: string): Promise<PiSettingsConfigFile> {
  try {
    const content = await readFile(configPath, 'utf8')
    return {
      path: configPath,
      exists: true,
      content,
    }
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) {
      throw new Error(`无法读取 ${basename(configPath)}：${error instanceof Error ? error.message : String(error)}`)
    }
    return {
      path: configPath,
      exists: false,
      content: '{\n}\n',
    }
  }
}

async function saveJsonConfigFile(configPath: string, fileName: string, content: string) {
  await writeFormattedJsonConfig(configPath, formatJsonConfig(fileName, content))
}

function formatJsonConfig(fileName: string, content: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(`${fileName} 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

async function writeFormattedJsonConfig(configPath: string, formatted: string) {
  // 设置页写的是 Pi 的真实配置。临时文件必须与目标文件同目录，rename 才能保持原子性，
  // 避免进程退出或磁盘错误把现有配置截断成半个 JSON。
  await mkdir(dirname(configPath), { recursive: true })
  const mode = await existingFileMode(configPath)
  const temporaryPath = join(dirname(configPath), `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, formatted, { encoding: 'utf8', mode })
    await rename(temporaryPath, configPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

type StagedConfigWrite = {
  configPath: string
  temporaryPath: string
  backupPath: string
  hadExistingFile: boolean
  backedUp: boolean
  committed: boolean
}

async function writeFormattedJsonConfigsAtomically(
  configs: Array<{ configPath: string; formatted: string }>,
) {
  const staged: StagedConfigWrite[] = []
  try {
    for (const config of configs) staged.push(await stageFormattedJsonConfig(config.configPath, config.formatted))

    for (const write of staged) {
      if (write.hadExistingFile) {
        await rename(write.configPath, write.backupPath)
        write.backedUp = true
      }
      await rename(write.temporaryPath, write.configPath)
      write.committed = true
    }
  } catch (error) {
    // rename 无法跨多个文件形成真正事务；按逆序恢复可保证可观察错误不会留下半套新配置。
    for (const write of [...staged].reverse()) {
      if (write.committed) await rm(write.configPath, { force: true }).catch(() => {})
      if (write.backedUp) await rename(write.backupPath, write.configPath).catch(() => {})
      await rm(write.temporaryPath, { force: true }).catch(() => {})
    }
    throw error
  }

  await Promise.all(staged.map((write) => rm(write.backupPath, { force: true }).catch(() => {})))
}

async function stageFormattedJsonConfig(configPath: string, formatted: string): Promise<StagedConfigWrite> {
  await mkdir(dirname(configPath), { recursive: true })
  const metadata = await existingFileMetadata(configPath)
  const nonce = `${process.pid}.${randomUUID()}`
  const temporaryPath = join(dirname(configPath), `.${basename(configPath)}.${nonce}.tmp`)
  const backupPath = join(dirname(configPath), `.${basename(configPath)}.${nonce}.bak`)
  await writeFile(temporaryPath, formatted, { encoding: 'utf8', mode: metadata.mode })
  return {
    configPath,
    temporaryPath,
    backupPath,
    hadExistingFile: metadata.exists,
    backedUp: false,
    committed: false,
  }
}

async function existingFileMode(configPath: string): Promise<number> {
  return (await existingFileMetadata(configPath)).mode
}

async function existingFileMetadata(configPath: string): Promise<{ exists: boolean; mode: number }> {
  try {
    const metadata = await stat(configPath)
    if (!metadata.isFile()) throw new Error(`${basename(configPath)} 不是普通文件`)
    return { exists: true, mode: metadata.mode & 0o777 }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return { exists: false, mode: 0o600 }
    throw error
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

async function discoverSkills(options: {
  agentDir: string
  cwd: string
  shell: string
  userSkillsDir: string
  piExecutablePath?: string
}): Promise<PiSkillInfo[]> {
  const piSkills = await discoverSkillsWithPiSdk(options)
  if (piSkills) return piSkills

  const configuredPaths = await readConfiguredSkillPaths(join(options.agentDir, 'settings.json'))
  const roots = [
    { path: join(options.agentDir, 'skills'), source: 'agent' as const },
    { path: options.userSkillsDir, source: 'user' as const },
    ...configuredPaths.map((path) => ({ path, source: 'configured' as const })),
  ]
  const skills = new Map<string, PiSkillInfo>()

  for (const root of roots) {
    for (const skill of await discoverSkillsInRoot(root.path, root.source)) {
      skills.set(skill.path, skill)
    }
  }

  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function discoverSkillsWithPiSdk(options: {
  agentDir: string
  cwd: string
  shell: string
  piExecutablePath?: string
}): Promise<PiSkillInfo[] | null> {
  try {
    const piExecutablePath = options.piExecutablePath ?? await resolvePiExecutable(options.shell)

    const modulePath = await resolvePiSdkModulePath(piExecutablePath)
    if (!modulePath) return null

    const sdk = await import(pathToFileURL(modulePath).href) as PiSdkModule
    if (!sdk.DefaultResourceLoader) return null

    // Settings 页展示“Pi 实际发现的 skills”，因此优先复用 Pi 自己的 ResourceLoader。
    // 这样能覆盖 package skills、~/.agents/skills、项目路径和 collision 处理等 Pi 内部规则。
    const loader = new sdk.DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.agentDir,
    })
    await loader.reload()
    const result = loader.getSkills()
    return (result.skills ?? [])
      .map(skillFromPiSdk)
      .filter((skill): skill is PiSkillInfo => skill !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return null
  }
}

async function resolvePiSdkModulePath(piExecutablePath: string): Promise<string | null> {
  let current = await realpath(piExecutablePath)
  if ((await stat(current)).isFile()) current = dirname(current)

  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = join(current, 'package.json')
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { name?: unknown; main?: unknown }
      if (packageJson.name === '@earendil-works/pi-coding-agent') {
        const main = typeof packageJson.main === 'string' ? packageJson.main : 'dist/index.js'
        return join(current, main)
      }
    } catch {
      // 继续向上找 package root；pi 命令可能是 bin symlink 或 dist/cli.js。
    }

    const next = dirname(current)
    if (next === current) return null
    current = next
  }

  return null
}

function skillFromPiSdk(skill: PiSdkSkill): PiSkillInfo | null {
  if (typeof skill.name !== 'string' || typeof skill.filePath !== 'string') return null
  return {
    name: skill.name,
    path: skill.filePath,
    ...(typeof skill.description === 'string' && skill.description ? { description: skill.description } : {}),
    source: 'pi',
  }
}

async function readConfiguredSkillPaths(settingsPath: string): Promise<string[]> {
  try {
    const raw = await readFile(settingsPath, 'utf8')
    const settings = JSON.parse(raw) as { skills?: unknown; skillPaths?: unknown }
    return [...pathsFromUnknown(settings.skills), ...pathsFromUnknown(settings.skillPaths)]
  } catch {
    return []
  }
}

function pathsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(expandHome)
}

async function discoverSkillsInRoot(rootPath: string, source: PiSkillInfo['source']): Promise<PiSkillInfo[]> {
  const absoluteRoot = expandHome(rootPath)
  if (!(await exists(absoluteRoot))) return []

  const rootStats = await stat(absoluteRoot)
  if (rootStats.isFile()) {
    const skill = await parseSkillFile(absoluteRoot, source)
    return skill ? [skill] : []
  }

  const directSkill = await parseSkillFile(join(absoluteRoot, 'SKILL.md'), source)
  if (directSkill) return [directSkill]

  const entries = await readdir(absoluteRoot, { withFileTypes: true })
  const skills: PiSkillInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skill = await parseSkillFile(join(absoluteRoot, entry.name, 'SKILL.md'), source)
    if (skill) skills.push(skill)
  }
  return skills
}

async function parseSkillFile(skillPath: string, source: PiSkillInfo['source']): Promise<PiSkillInfo | null> {
  try {
    const content = await readFile(skillPath, 'utf8')
    const frontmatter = parseFrontmatter(content)
    const name = frontmatter.name || dirname(skillPath).split('/').pop() || skillPath
    return {
      name,
      path: skillPath,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      source,
    }
  } catch {
    return null
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const values: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    if (key) values[key] = value
  }
  return values
}

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return join(homedir(), input.slice(2))
  return resolve(input)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function outputFromExecError(error: unknown): string {
  const maybeOutput = error as { stdout?: unknown; stderr?: unknown }
  return [maybeOutput.stdout, maybeOutput.stderr]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .trim()
}
