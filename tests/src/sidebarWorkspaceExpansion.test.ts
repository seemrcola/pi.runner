import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('workspace sidebar expansion flow', () => {
  test('keeps workspace expansion state in App so creation and selection can reveal the target workspace', () => {
    const app = readSource('../../src/App.vue')
    const shell = readSource('../../src/composables/useAppSessionShell.ts')
    const lifecycle = readSource('../../src/composables/conversationLifecycle/creation.ts')

    expect(lifecycle).toContain('ensureWorkspaceExpanded')
    expect(shell).toContain('const expandedWorkspaces = ref(new Set<string>())')
    expect(lifecycle).toContain('function revealWorkspace')
    expect(lifecycle).toContain('revealWorkspace(normalizedWorkspacePath)')
    expect(lifecycle).toContain('revealWorkspace(conversation.workspacePath)')
    expect(lifecycle).toContain('function addWorkspaceConversation(workspacePath: string)')
    expect(lifecycle).toContain("createConversation('workspace', normalizeWorkspacePath(workspacePath))")
    expect(app).toContain(':expanded-workspaces="expandedWorkspaces"')
    expect(app).toContain('@add-workspace-conversation="addWorkspaceConversation"')
    expect(app).toContain('@update-expanded-workspaces="expandedWorkspaces = $event"')
  })

  test('makes Sidebar a controlled view of workspace expansion state', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain('expandedWorkspaces: ReadonlySet<string>')
    expect(sidebar).toContain('updateExpandedWorkspaces: [expandedWorkspaces: Set<string>]')
    expect(sidebar).toContain('props.expandedWorkspaces')
    expect(sidebar).toContain("emit('updateExpandedWorkspaces'")
    expect(sidebar).not.toContain('const expandedWorkspaces = ref(new Set<string>())')
  })

  test('keeps workspace visibility controlled by parent conversations only', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const workspaceSidebar = readSource('../../src/lib/workspaceSidebar.ts')

    expect(sidebar).not.toContain('hiddenWorkspaces')
    expect(sidebar).not.toContain('hideWorkspace')
    expect(workspaceSidebar).not.toContain('hiddenWorkspaces')
    expect(workspaceSidebar).not.toContain('hideWorkspace')
  })
})
