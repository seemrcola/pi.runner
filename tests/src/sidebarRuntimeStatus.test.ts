import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('sidebar conversation runtime status', () => {
  test('App passes per-conversation runtime statuses to the sidebar', () => {
    const app = readSource('../../src/App.vue')
    const shell = readSource('../../src/composables/useAppSessionShell.ts')

    expect(shell).toContain('const conversationStatuses = computed')
    expect(app).toContain(':conversation-statuses="conversationStatuses"')
  })

  test('Sidebar renders per-conversation runtime status markers', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const item = readSource('../../src/components/chat/ConversationListItem.vue')
    const dot = readSource('../../src/components/chat/ConversationStatusDot.vue')

    expect(sidebar).toContain('conversationStatuses?: Record<string, ConversationRuntimeStatus>')
    expect(sidebar).toContain('function statusFor(conversationId: string)')
    expect(sidebar).toContain(':status="statusFor(conv.id)"')
    expect(item).toContain('<ConversationStatusDot :status="status" />')
    expect(dot).toContain("running: 'bg-primary'")
    expect(dot).toContain("starting: 'bg-amber-400'")
  })

  test('Sidebar add flow uses user-facing conversation and workspace copy', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain('新建会话')
    expect(sidebar).toContain('在工作区开始')
    expect(sidebar).toContain('开始普通会话')
    expect(sidebar).not.toContain('新建对话')
    expect(sidebar).not.toContain('仅开启会话')
    expect(sidebar).not.toContain('选择已有项目')
    expect(sidebar).not.toContain('添加对话')
  })
})
