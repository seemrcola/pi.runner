import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveDesktopDataDir(env: Partial<Pick<NodeJS.ProcessEnv, 'PI_DESKTOP_DATA_DIR'>> = process.env): string {
  return env.PI_DESKTOP_DATA_DIR ?? join(homedir(), 'pi.runner', 'data')
}
