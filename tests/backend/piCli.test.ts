import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiProcessEnv, resolvePiExecutable } from '../../backend/pi/cli.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Pi CLI environment', () => {
  it('uses only the Node version selected by the login shell PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-cli-env-'))
    tempDirs.push(root)
    const node20Bin = join(root, 'v20', 'bin')
    const node24Bin = join(root, 'v24', 'bin')
    await Promise.all([mkdir(node20Bin, { recursive: true }), mkdir(node24Bin, { recursive: true })])
    await writeFile(join(node24Bin, 'pi'), '#!/usr/bin/env node\n', 'utf8')
    await chmod(join(node24Bin, 'pi'), 0o755)

    const shell = join(root, 'shell')
    await writeFile(
      shell,
      `#!/bin/sh\nexport PATH='${node24Bin}:${node20Bin}:/usr/bin:/bin'\nexec /bin/sh "$@"\n`,
      'utf8',
    )
    await chmod(shell, 0o755)

    await expect(resolvePiExecutable(shell)).resolves.toBe(join(node24Bin, 'pi'))
  })

  it('keeps the shell PATH and removes Electron-only Node mode', () => {
    const env = createPiProcessEnv(
      { PATH: '/from/electron', ELECTRON_RUN_AS_NODE: '1', PI_DESKTOP_BACKEND_TOKEN: 'token' },
      { PATH: ['/node24/bin', '/usr/bin'].join(delimiter) },
    )

    expect(env).toMatchObject({ PATH: '/node24/bin:/usr/bin', PI_DESKTOP_BACKEND_TOKEN: 'token' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})
