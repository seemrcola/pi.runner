import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createSettingsService } from '../../backend/settings/settingsService.js'
import { createFakeChildProcess } from '../helpers/fakeChildProcess.js'

async function createTempDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('settings service', () => {
  it('owns the installer child and terminates it during backend shutdown', async () => {
    const root = await createTempDir('pi-settings-install-process-')
    const child = createFakeChildProcess(8123)
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
      return true
    })
    const spawnProcess = vi.fn(() => child)
    try {
      const service = createSettingsService({
        agentDir: join(root, 'agent'),
        cwd: root,
        shell: '/bin/false',
        spawnProcess: spawnProcess as never,
        userSkillsDir: join(root, 'skills'),
      })

      const install = service.installPi()
      await expect(service.installPi()).rejects.toThrow('Pi 安装进程已经在运行')
      await service.shutdown()
      const snapshot = await install

      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      expect(snapshot.install).toMatchObject({ phase: 'failed' })
      expect(spawnProcess).toHaveBeenCalledWith(
        '/bin/false',
        ['-lc', expect.stringContaining('curl -fsSL https://pi.dev/install.sh')],
        { shell: false },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the installed Pi SDK resource loader when available', async () => {
    const root = await createTempDir('pi-settings-sdk-')
    try {
      const packageRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({
          name: '@earendil-works/pi-coding-agent',
          type: 'module',
          main: './dist/index.js',
        }),
        'utf8',
      )
      await writeFile(join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n', 'utf8')
      await chmod(join(packageRoot, 'dist', 'cli.js'), 0o755)
      await writeFile(
        join(packageRoot, 'dist', 'index.js'),
        `
          export class DefaultResourceLoader {
            constructor(options) {
              this.options = options
            }
            async reload() {}
            getSkills() {
              return {
                skills: [
                  {
                    name: 'sdk-skill',
                    description: 'Loaded by Pi SDK',
                    filePath: this.options.agentDir + '/sdk-skill/SKILL.md',
                    sourceInfo: {
                      path: this.options.agentDir + '/sdk-skill/SKILL.md',
                      source: 'auto',
                      scope: 'user',
                      origin: 'top-level',
                      baseDir: this.options.agentDir
                    }
                  }
                ],
                diagnostics: []
              }
            }
          }
        `,
        'utf8',
      )

      const service = createSettingsService({
        agentDir: join(root, 'agent'),
        cwd: join(root, 'project'),
        piExecutablePath: join(packageRoot, 'dist', 'cli.js'),
        shell: '/bin/sh',
      })

      const snapshot = await service.snapshot()

      expect(snapshot.pi).toEqual({
        installed: true,
        executablePath: join(packageRoot, 'dist', 'cli.js'),
      })
      expect(snapshot.skills).toEqual([
        {
          name: 'sdk-skill',
          description: 'Loaded by Pi SDK',
          path: join(root, 'agent', 'sdk-skill', 'SKILL.md'),
          source: 'pi',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to local skill directory scanning when the Pi SDK is unavailable', async () => {
    const root = await createTempDir('pi-settings-fallback-')
    try {
      const skillDir = join(root, 'agent', 'skills', 'fallback-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: fallback-skill\ndescription: Loaded by fallback scanner\n---\n\n# fallback-skill\n',
        'utf8',
      )

      const service = createSettingsService({
        agentDir: join(root, 'agent'),
        cwd: join(root, 'project'),
        shell: '/bin/false',
        userSkillsDir: join(root, 'user-skills'),
      })

      const snapshot = await service.snapshot()

      expect(snapshot.skills).toContainEqual(
        {
          name: 'fallback-skill',
          description: 'Loaded by fallback scanner',
          path: join(skillDir, 'SKILL.md'),
          source: 'agent',
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('includes settings.json content in the settings snapshot', async () => {
    const root = await createTempDir('pi-settings-file-')
    try {
      const agentDir = join(root, 'agent')
      await mkdir(agentDir, { recursive: true })
      await writeFile(join(agentDir, 'settings.json'), '{"skills":["~/custom-skills"]}\n', 'utf8')

      const service = createSettingsService({
        agentDir,
        cwd: join(root, 'project'),
        shell: '/bin/false',
        userSkillsDir: join(root, 'user-skills'),
      })

      const snapshot = await service.snapshot()

      expect(snapshot.settings).toEqual({
        path: join(agentDir, 'settings.json'),
        exists: true,
        content: '{"skills":["~/custom-skills"]}\n',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates and formats settings.json before saving it', async () => {
    const root = await createTempDir('pi-settings-save-file-')
    try {
      const agentDir = join(root, 'agent')
      const service = createSettingsService({
        agentDir,
        cwd: join(root, 'project'),
        shell: '/bin/false',
        userSkillsDir: join(root, 'user-skills'),
      })

      const snapshot = await service.saveSettings('{"skills":["~/custom-skills"]}')

      expect(snapshot.settings).toEqual({
        path: join(agentDir, 'settings.json'),
        exists: true,
        content: '{\n  "skills": [\n    "~/custom-skills"\n  ]\n}\n',
      })
      await expect(readFile(join(agentDir, 'settings.json'), 'utf8')).resolves.toBe(
        '{\n  "skills": [\n    "~/custom-skills"\n  ]\n}\n',
      )
      await expect(readdir(agentDir)).resolves.toEqual(['settings.json'])
      await expect(service.saveSettings('{')).rejects.toThrow('settings.json 不是有效 JSON')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates both files before writing combined settings', async () => {
    const root = await createTempDir('pi-settings-save-all-')
    try {
      const agentDir = join(root, 'agent')
      await mkdir(agentDir, { recursive: true })
      await writeFile(join(agentDir, 'models.json'), '{"old":true}\n', 'utf8')
      await writeFile(join(agentDir, 'settings.json'), '{"old":true}\n', 'utf8')
      const service = createSettingsService({ agentDir, cwd: root, shell: '/bin/false', userSkillsDir: join(root, 'skills') })

      await expect(service.saveAll('{"model":"new"}', '{')).rejects.toThrow('settings.json 不是有效 JSON')
      await expect(readFile(join(agentDir, 'models.json'), 'utf8')).resolves.toBe('{"old":true}\n')
      await expect(readFile(join(agentDir, 'settings.json'), 'utf8')).resolves.toBe('{"old":true}\n')

      const snapshot = await service.saveAll('{"model":"new"}', '{"skills":[]}')
      expect(snapshot.models.content).toContain('"model": "new"')
      expect(snapshot.settings.content).toContain('"skills": []')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not update either file when a combined-save target is not a regular file', async () => {
    const root = await createTempDir('pi-settings-save-all-target-')
    try {
      const agentDir = join(root, 'agent')
      await mkdir(join(agentDir, 'settings.json'), { recursive: true })
      await writeFile(join(agentDir, 'models.json'), '{"old":true}\n', 'utf8')
      const service = createSettingsService({ agentDir, cwd: root, shell: '/bin/false', userSkillsDir: join(root, 'skills') })

      await expect(service.saveAll('{"model":"new"}', '{"skills":[]}')).rejects.toThrow('settings.json 不是普通文件')
      await expect(readFile(join(agentDir, 'models.json'), 'utf8')).resolves.toBe('{"old":true}\n')
      expect((await stat(join(agentDir, 'settings.json'))).isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not treat unreadable config paths as missing files', async () => {
    const root = await createTempDir('pi-settings-read-error-')
    try {
      const agentDir = join(root, 'agent')
      await mkdir(join(agentDir, 'settings.json'), { recursive: true })
      const service = createSettingsService({
        agentDir,
        cwd: join(root, 'project'),
        shell: '/bin/false',
        userSkillsDir: join(root, 'user-skills'),
      })

      await expect(service.snapshot()).rejects.toThrow('无法读取 settings.json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
