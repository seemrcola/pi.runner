import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath } from '../../../shared/workspacePaths.js'

describe('workspace path helpers', () => {
  it('normalizes equivalent workspace paths to one stable identity', () => {
    expect(normalizeWorkspacePath(' /tmp/project/ ')).toBe('/tmp/project')
    expect(normalizeWorkspacePath('/tmp/project/../project')).toBe('/tmp/project')
    expect(normalizeWorkspacePath('/tmp//project')).toBe('/tmp/project')
  })

  it('keeps empty workspace paths empty', () => {
    expect(normalizeWorkspacePath('   ')).toBe('')
  })
})
