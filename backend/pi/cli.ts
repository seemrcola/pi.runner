import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SHELL_ENV_MARKER = 'PI_DESKTOP_SHELL_ENV_BEGIN'
const shellEnvPromises = new Map<string, Promise<NodeJS.ProcessEnv>>()

let piMajorVersion: number | null = null

export async function resolvePiExecutable(shell = defaultShell()): Promise<string> {
  const env = await buildProcessEnv(shell)
  const override = env.PI_CLI_PATH?.trim()
  if (override) return override

  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'pi')
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // 当前 PATH 项没有可执行的 Pi，继续查找下一项。
    }
  }

  throw new Error('未在用户登录 shell 的 PATH 中找到 Pi 命令')
}

export function createPiProcessEnv(
  inheritedEnv: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...inheritedEnv, ...shellEnv }
  // 该变量只用于把打包后的 Electron 可执行文件切换成 backend Node 进程；
  // 外部 Pi 及其后代不能继承，否则它们启动 Electron 时会被意外改成 Node 模式。
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

export function buildProcessEnv(shell = defaultShell()): Promise<NodeJS.ProcessEnv> {
  let promise = shellEnvPromises.get(shell)
  if (!promise) {
    promise = readLoginShellEnv(shell).then((shellEnv) => createPiProcessEnv(process.env, shellEnv))
    shellEnvPromises.set(shell, promise)
  }
  return promise
}

export function refreshPiProcessEnv(shell = defaultShell()): void {
  shellEnvPromises.delete(shell)
  piMajorVersion = null
}

export async function supportsApprove(executable: string): Promise<boolean> {
  if (piMajorVersion !== null) return piMajorVersion >= 79
  try {
    const { stdout } = await execFileAsync(executable, ['--version'], {
      timeout: 5000,
      env: await buildProcessEnv(),
    })
    piMajorVersion = parseMajorVersion(stdout.trim())
  } catch {
    piMajorVersion = 0
  }
  return piMajorVersion >= 79
}

export function splitArgs(value = ''): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(stripQuotes) ?? []
}

async function readLoginShellEnv(shell: string): Promise<NodeJS.ProcessEnv> {
  // Finder 启动的 App 不带终端 PATH。通过交互式登录 shell 获取与用户终端一致的完整环境；
  // NUL marker 可以隔离 shell 初始化脚本写到 stdout 的额外内容。
  const command = `/usr/bin/printf '\\0${SHELL_ENV_MARKER}\\0'; /usr/bin/env -0`
  const { stdout } = await execFileAsync(shell, ['-ilc', command], {
    env: process.env,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    encoding: 'buffer',
  })
  const entries = stdout.toString().split('\0')
  const markerIndex = entries.lastIndexOf(SHELL_ENV_MARKER)
  if (markerIndex < 0) throw new Error(`无法从登录 shell 读取环境：${shell}`)

  const env: NodeJS.ProcessEnv = {}
  for (const entry of entries.slice(markerIndex + 1)) {
    const separator = entry.indexOf('=')
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return env
}

function defaultShell(): string {
  return process.env.SHELL ?? '/bin/zsh'
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseMajorVersion(version: string): number {
  const match = version.match(/(\d+)\.(\d+)/)
  if (match) return parseInt(match[2], 10)
  const major = parseInt(version, 10)
  return Number.isFinite(major) ? major : 0
}
