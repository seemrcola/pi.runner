import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('header controls', () => {
  test('ChatHeader does not expose unused plugin controls', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    const app = readSource('../../src/App.vue')

    expect(header).not.toContain('PiExtensionSummary')
    expect(header).not.toContain('extensions:')
    expect(header).not.toContain("'refresh-extensions'")
    expect(header).not.toContain("'install-extension'")
    expect(header).not.toContain("'uninstall-extension'")
    expect(header).not.toContain("'update-extensions'")
    expect(header).not.toContain('Plugins')
    expect(header).not.toContain('aria-label="插件"')
    expect(app).not.toContain('requestPiExtensions')
    expect(app).not.toContain('installExtension')
    expect(app).not.toContain('uninstallExtension')
    expect(app).not.toContain('updateExtensions')
  })

  test('Sidebar and ChatHeader use a matched fixed header height', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const header = readSource('../../src/components/chat/ChatHeader.vue')

    expect(sidebar).toContain('h-14')
    expect(sidebar).toContain('shrink-0')
    expect(header).toContain('h-14')
    expect(header).toContain('shrink-0')
  })

  test('App restores and persists workspace sidebar view state through backend messages', () => {
    const app = readSource('../../src/App.vue')
    const shell = readSource('../../src/composables/useAppSessionShell.ts')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const events = readSource('../../src/composables/useBackendEvents.ts')
    const workspaceEvents = readSource('../../src/composables/backendEvents/workspaceViewEvents.ts')

    expect(shell).toContain("type: 'list_workspace_view_states'")
    expect(app).toContain('@update-workspace-view-state="updateWorkspaceViewState"')
    expect(sidebar).toContain('workspaceViewStates')
    expect(sidebar).toContain("emit('updateWorkspaceViewState'")
    expect(events).toContain('handleWorkspaceViewStateMessage')
    expect(workspaceEvents).toContain("case 'workspace_view_states:list':")
    expect(workspaceEvents).toContain("case 'workspace_view_state:updated':")
  })

  test('ChatHeader surfaces the active conversation context and uses user-facing refresh copy', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    const app = readSource('../../src/App.vue')

    expect(header).toContain('conversationTitle')
    expect(header).toContain('contextLabel')
    expect(header).toContain('runtimeError')
    expect(app).toContain(':conversation-title="activeConversation?.title ??')
    expect(app).toContain(':conversation-kind="activeConversation?.kind ??')
  })
})

describe('message input', () => {
  test('MessageInput avoids internal steer wording in visible UI copy', () => {
    const input = readSource('../../src/components/chat/MessageInput.vue')

    expect(input).toContain('追加指令')
    expect(input).toContain('给 Pi 发送任务')
    expect(input).not.toContain('>steer<')
    expect(input).not.toContain('Send steer')
    expect(input).not.toContain('删除 steer')
  })

  test('Chat surface keeps visible helper and action copy localized', () => {
    const input = readSource('../../src/components/chat/MessageInput.vue')
    const messageList = readSource('../../src/components/message/MessageList.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')

    expect(messageList).toContain('发送一条消息开始')
    expect(input).toContain('title="停止"')
    expect(sidebar).toContain('title="工作区操作"')
    expect(sidebar).toContain('aria-label="工作区操作"')
    expect(listItem).toContain('title="会话操作"')
    expect(listItem).toContain('aria-label="会话操作"')
    expect(messageList).not.toContain('Send a message to start')
    expect(input).not.toContain('title="Stop"')
    expect(sidebar).not.toContain('More workspace actions')
    expect(listItem).not.toContain('More conversation actions')
  })
})
