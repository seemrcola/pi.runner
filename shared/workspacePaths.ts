export function normalizeWorkspacePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const path = trimmed.replace(/\\/g, '/')
  const isAbsolute = path.startsWith('/')
  const segments: string[] = []

  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop()
      } else if (!isAbsolute) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }

  const normalized = `${isAbsolute ? '/' : ''}${segments.join('/')}`
  if (normalized) return normalized
  return isAbsolute ? '/' : '.'
}

export function normalizeWorkspacePathSet(paths: ReadonlySet<string>): Set<string> {
  const normalized = new Set<string>()
  for (const path of paths) {
    const workspacePath = normalizeWorkspacePath(path)
    if (workspacePath) normalized.add(workspacePath)
  }
  return normalized
}
