import { execFileSync } from 'node:child_process'

export type ProcessIdentity = {
  pid: number
  startedAt: string
  command: string
  state?: string
}

export type ProcessIdentityReader = (pid: number) => ProcessIdentity | null

export const readProcessIdentity: ProcessIdentityReader = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    const output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'state=', '-o', 'command='], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 3_000,
    }).trim()
    const match = output.match(/^(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/)
    if (!match) return null
    return { pid, startedAt: match[1], state: match[2], command: match[3] }
  } catch {
    return null
  }
}

export function isSameLiveProcess(expected: ProcessIdentity, read: ProcessIdentityReader = readProcessIdentity): boolean {
  const current = read(expected.pid)
  return Boolean(
    current
    && !current.state?.startsWith('Z')
    && current.startedAt === expected.startedAt
    && current.command === expected.command,
  )
}
