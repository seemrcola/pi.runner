import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

function expectTextBefore(source: string, before: string, after: string) {
  const beforeIndex = source.indexOf(before)
  const afterIndex = source.indexOf(after)
  expect(beforeIndex, `${before} should exist`).toBeGreaterThanOrEqual(0)
  expect(afterIndex, `${after} should exist`).toBeGreaterThanOrEqual(0)
  expect(beforeIndex).toBeLessThan(afterIndex)
}

describe('chat layout overflow constraints', () => {
  test('keeps the right content column from creating page-level horizontal scroll', () => {
    const app = readSource('../../src/App.vue')
    const messageList = readSource('../../src/components/message/MessageList.vue')

    expect(app).toContain('grid-cols-[260px_minmax(0,1fr)]')
    expect(app).toContain('min-w-0')
    expect(messageList).toContain('min-w-0')
    expect(messageList).toContain('<ScrollArea')
    expect(messageList).toContain('viewport-class="px-10 py-6"')
  })

  test('keeps the settings page scrollbar on the window edge, away from editor scrollbars', () => {
    const settings = readSource('../../src/components/settings/SettingsView.vue')

    expect(settings).toContain('<ScrollArea class="h-full bg-background">')
    expect(settings).toContain('w-full')
    expect(settings).toContain('mx-auto flex h-full w-[75vw]')
    expect(settings).toContain('mx-auto flex w-[75vw] flex-col gap-5')
    expect(settings).not.toContain('max-w-5xl')
  })

  test('keeps unavailable conversation entry points visibly disabled', () => {
    const app = readSource('../../src/App.vue')
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(app).toContain(':is-connected="isConnected"')
    expect(app).toContain(':disabled="!isConnected"')
    expect(header.match(/:disabled="!isConnected"/g)?.length).toBe(1)
    expect(sidebar).toContain(':disabled="!isConnected || activeTaskCount > 0 || isHistorySyncing"')
    expect(header).toContain("'后端未连接'")
    expect(sidebar).toContain('isConnected: boolean')
    expect(sidebar).toContain(':disabled="!isConnected"')
    expect(sidebar).toContain('连接后可开始会话')
    expect(sidebar).toContain('<DialogDescription class="sr-only">')
  })

  test('uses the shared ScrollArea for app-owned regions without global scrollbar overrides', () => {
    const css = readSource('../../src/assets/index.css')
    const messageList = readSource('../../src/components/message/MessageList.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const commandPalette = readSource('../../src/components/chat/CommandPalette.vue')
    const timeline = readSource('../../src/components/chat/TimelineNavigator.vue')
    const settings = readSource('../../src/components/settings/SettingsView.vue')
    const input = readSource('../../src/components/chat/MessageInput.vue')

    expect(css).not.toContain('::-webkit-scrollbar')
    for (const source of [messageList, sidebar, commandPalette, timeline, settings]) {
      expect(source).toContain("from '@/components/ui/scroll-area'")
      expect(source).toContain('<ScrollArea')
    }
    expect(input).toContain('rounded-lg')
    expect(input).not.toContain('rounded-2xl')
  })

  test('keeps message scroll behavior attached to the shared viewport', () => {
    const scrollArea = readSource('../../src/components/ui/scroll-area/ScrollArea.vue')
    const messageList = readSource('../../src/components/message/MessageList.vue')

    expect(scrollArea).toContain('function viewportElement()')
    expect(scrollArea).toContain('defineExpose({ viewportElement })')
    expect(scrollArea).toContain(`@scroll.passive="emit('scroll', $event)"`)
    expect(messageList).toContain('scrollAreaRef.value?.viewportElement()')
    expect(messageList).toContain('@scroll="onScroll"')
  })

  test('keeps settings header sticky and draggable without blocking header buttons', () => {
    const settings = readSource('../../src/components/settings/SettingsView.vue')

    expect(settings).toContain('sticky top-0 z-10')
    expect(settings).toContain('app-drag')
    expect(settings).toContain('app-no-drag')
  })

  test('does not present missing settings data as a detected local state', () => {
    const app = readSource('../../src/App.vue')
    const settings = readSource('../../src/components/settings/SettingsView.vue')
    const unavailableState = settings.slice(
      settings.indexOf('v-if="!isConnected || !snapshot"'),
      settings.indexOf('<template v-else>'),
    )

    expect(settings).toContain('isConnected: boolean')
    expect(app).toContain(':is-connected="isConnected"')
    expect(unavailableState).toContain('isConnected && isLoading')
    expect(unavailableState).toContain('正在读取 Pi 设置…')
    expect(unavailableState).toContain('暂时无法连接后端')
    expect(unavailableState).toContain("emit('refresh')")
    expect(settings).toContain('<template v-else>')
  })

  test('wraps long tool command summaries instead of overflowing the trigger', () => {
    const toolMessage = readSource('../../src/components/message/ToolMessage.vue')

    expect(toolMessage).toContain('summaryTitle')
    expect(toolMessage).toContain('fullToolName')
    expect(toolMessage).toContain('truncate')
    expect(toolMessage).toContain('text-left')
  })

  test('renders edit tool diffs inside the existing tool detail block', () => {
    const toolMessage = readSource('../../src/components/message/ToolMessage.vue')

    expect(toolMessage).toContain('diffLines')
    expect(toolMessage).toContain('diffLineClass')
    expect(toolMessage).toContain('v-if="tool.diff"')
    expect(toolMessage).toContain('text-emerald-300')
    expect(toolMessage).toContain('text-red-300')
  })

  test('aligns tool call width with thinking blocks', () => {
    const assistantMessage = readSource('../../src/components/message/AssistantMessage.vue')

    expect(assistantMessage).toContain('class="mr-12"')
    expect(assistantMessage).toContain('class="ml-7 mb-2"')
    expect(assistantMessage).toContain('class="ml-7 mt-2 space-y-1.5"')
  })

  test('renders workspace menu actions with select handlers so rename can trigger', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain("@select.prevent=\"toggleWorkspacePin(group.workspacePath)\"")
    expect(sidebar).toContain("@select.prevent=\"openWorkspaceFolder(group.workspacePath)\"")
    expect(sidebar).toContain("@select.prevent=\"removeWorkspace(group.workspacePath)\"")
    expect(sidebar).toContain("deleteWorkspace: [workspacePath: string]")
    expect(sidebar).toContain('<span v-else>移除工作区</span>')
  })

  test('removes the sidebar import button and shows an empty workspace state', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).not.toContain('扫描PI会话记录')
    expect(sidebar).not.toContain('同步PI会话记录')
    expect(sidebar).toContain('暂无工作区')
  })

  test('removes the header working-directory status block', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')

    expect(header).not.toContain('No working directory')
    expect(header).not.toContain('PI ready')
  })

  test('keeps global actions in the header and scopes history refresh to the sidebar', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(header).toContain("emit('new-conversation')")
    expect(header).not.toContain("emit('import-sessions')")
    expect(header).toContain("emit('command-palette')")
    expect(header).toContain('新会话')
    expect(header).toContain('搜索')
    expect(header).not.toContain('刷新历史')
    expect(header).toContain("<TooltipContent>{{ isConnected ? '新会话' : '后端未连接' }}</TooltipContent>")
    expect(header).toContain('<TooltipContent>搜索</TooltipContent>')
    expect(sidebar).toContain("refreshHistory: []")
    expect(sidebar).toContain("emit('refreshHistory')")
    expect(sidebar).toContain('aria-label="同步历史"')
    expect(sidebar).toContain('从 Pi 会话目录同步会话和工作区历史')
    expect(sidebar).toContain(':disabled="!isConnected || activeTaskCount > 0 || isHistorySyncing"')
    expect(sidebar).toContain("isHistorySyncing && 'animate-spin'")
    const sessionsSection = sidebar.slice(sidebar.indexOf('<section>'), sidebar.indexOf('<section>', sidebar.indexOf('<section>') + 1))
    expect(sessionsSection).not.toContain('同步历史')
    expect(sidebar).not.toContain("emit('new')")
  })

  test('uses explicit connection recovery labels in the chat header', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    expect(header).toContain('connectionState')
    expect(header).toContain('正在连接')
    expect(header).toContain('正在重新连接')
    expect(header).toContain('连接失败，自动重试')
  })

  test('reserves macOS traffic light space before the sidebar logo', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain('pl-24')
    expect(sidebar).toContain('Pi RUNNER')
    expect(sidebar).toContain('class="sidebar-wordmark"')
    expect(sidebar).toContain('class="sidebar-wordmark-runner"')
  })

  test('keeps sidebar branding quiet without remote fonts or decorative glitch motion', () => {
    const css = readSource('../../src/assets/index.css')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).not.toContain('Press Start 2P')
    expect(css).not.toContain('@keyframes glitch')
    expect(css).not.toContain('background-clip: text')
    expect(sidebar).not.toContain('glitch')
    expect(sidebar).not.toContain('font-pixel')
    expect(sidebar).toContain('src="/app-icon.png"')
    expect(sidebar).not.toContain('src="/app-icon.svg"')
    expect(sidebar).not.toContain('function PiMark')
    expect(sidebar).not.toContain('<PiMark')
    expect(sidebar).not.toContain('>PI</span>')
    expect(sidebar).not.toContain('tracking-[0.22em]')
  })

  test('marks top chrome as draggable while preserving button clicks', () => {
    const header = readSource('../../src/components/chat/ChatHeader.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(header).toContain('app-drag')
    expect(sidebar).toContain('app-drag')
    expect(header).toContain('app-no-drag')
    expect(sidebar).toContain('app-no-drag')
  })

  test('renders sidebar conversation status as a centered ripple dot', () => {
    const statusDot = readSource('../../src/components/chat/ConversationStatusDot.vue')

    expect(statusDot).toContain('relative flex size-3.5 shrink-0 items-center justify-center')
    expect(statusDot).toContain('animate-ping')
    expect(statusDot).toContain('border-primary/50')
  })

  test('forwards tooltip provider props to the underlying provider', () => {
    const tooltip = readSource('../../src/components/ui/tooltip/Tooltip.vue')

    expect(tooltip).toContain('const props = defineProps<TooltipProviderProps>()')
    expect(tooltip).toContain('<TooltipProvider v-bind="props">')
  })

  test('uses one shared conversation row component for sidebar session and workspace rows', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain("import ConversationListItem from './ConversationListItem.vue'")
    expect(sidebar.match(/<ConversationListItem/g)?.length).toBe(2)
  })

  test('uses remove copy for conversation visibility actions', () => {
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(listItem).toContain("canRemove ? '移除' : '任务进行中，停止后才能移除'")
    expect(listItem).not.toContain('<span>删除</span>')
    expect(listItem).toContain(':disabled="!canRemove"')
    expect(listItem).toContain("任务进行中，停止后才能移除")
    expect(sidebar).toContain(':can-remove="!isTaskActive(statusFor(conv.id))"')
    expect(sidebar).toContain("status === 'stopping'")
    expect(sidebar).toContain(':disabled="group.activeTaskCount > 0"')
    expect(sidebar).toContain('工作区有 {{ group.activeTaskCount }} 个任务进行中')
  })

  test('marks unsent conversations as temporary drafts', () => {
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')
    expect(listItem).toContain('isTemporaryDraft')
    expect(listItem).toContain('>草稿</span>')
    expect(listItem).toContain('发送第一条消息后才会持久化')
  })

  test('places add conversation first in the workspace actions menu', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const workspaceMenu = sidebar.slice(
      sidebar.indexOf('<DropdownMenuContent align="end" class="w-44">'),
      sidebar.indexOf('<DropdownMenuItem variant="destructive" @select.prevent="removeWorkspace(group.workspacePath)">'),
    )

    expect(sidebar).toContain("addWorkspaceConversation: [workspacePath: string]")
    expect(workspaceMenu).toContain("@select.prevent=\"addWorkspaceConversation(group.workspacePath)\"")
    expect(sidebar).not.toContain('新建对话')
    expectTextBefore(workspaceMenu, '<span>新建会话</span>', 'toggleWorkspacePin')
  })

  test('exposes direct empty-state actions for both session and workspace starts', () => {
    const app = readSource('../../src/App.vue')
    const emptyState = app.slice(app.indexOf('v-else class="flex min-w-0 flex-1'), app.indexOf('<!-- 输入区 -->'))

    expect(emptyState).toContain('@click="startSessionOnly"')
    expect(emptyState).toContain('@click="chooseWorkspaceFolder"')
    expect(emptyState).toContain('普通会话')
    expect(emptyState).toContain('选择工作区')
  })

  test('uses action-oriented labels in the new conversation dialog', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const dialog = sidebar.slice(sidebar.indexOf('<DialogContent'), sidebar.indexOf('</DialogContent>'))

    expect(dialog).toContain('在工作区开始')
    expect(dialog).toContain('开始普通会话')
    expect(dialog).not.toContain('选择会话要绑定的上下文')
  })

  test('keeps workspace actions discoverable without hover-only visibility', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const workspaceTrigger = sidebar.slice(
      sidebar.indexOf('aria-label="工作区操作"') - 260,
      sidebar.indexOf('aria-label="工作区操作"') + 120,
    )

    expect(workspaceTrigger).toContain('aria-label="工作区操作"')
    expect(workspaceTrigger).not.toContain('opacity-0')
    expect(workspaceTrigger).not.toContain('group-hover/workspace:opacity-100')
  })

  test('marks pinned workspaces with a distinct visual state', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')

    expect(sidebar).toContain('group.isPinned')
    expect(sidebar).toContain('置顶')
    expect(sidebar).toContain('bg-primary/5 ring-1 ring-primary/10')
    expect(sidebar).toContain('bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary')
  })

  test('keeps sidebar rows compact by hiding previews and workspace metadata', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')

    expect(sidebar).not.toContain('function preview')
    expect(sidebar).not.toContain(':preview=')
    expect(sidebar).not.toContain('displayWorkspacePath')
    expect(sidebar).not.toContain('{{ group.conversations.length }}')
    expect(listItem).not.toContain('preview: string')
    expect(listItem).not.toContain('{{ preview }}')
  })

  test('keeps sidebar row labels vertically centered with tighter row height', () => {
    const sidebar = readSource('../../src/components/chat/Sidebar.vue')
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')

    expect(sidebar).toContain('group/workspace flex w-full items-center')
    expect(sidebar).toContain('class="flex min-w-0 flex-1 items-center')
    expect(sidebar).toContain('size-3.5 shrink-0 text-muted-foreground transition-transform')
    expect(sidebar).not.toContain("'mt-1 size-3.5")
    expect(listItem).toContain('group/item flex h-8 items-center gap-1.5 rounded-sm')
    expect(listItem).toContain('truncate text-[12px] font-medium')
    expect(listItem).toContain('size-7')
  })

  test('supports keyboard selection and visible focus for every conversation action', () => {
    const listItem = readSource('../../src/components/chat/ConversationListItem.vue')
    const selectionControl = listItem.slice(
      listItem.indexOf('<button'),
      listItem.indexOf('</button>') + '</button>'.length,
    )

    expect(selectionControl).toContain('type="button"')
    expect(selectionControl).toContain(':aria-current="isActive ? \'page\' : undefined"')
    expect(selectionControl).toContain("@click=\"emit('select', conversation.id)\"")
    expect(selectionControl).toContain('focus-visible:ring-2')
    expect(listItem).toContain('group-focus-within/item:opacity-100')
    expect(listItem).toContain('focus-visible:opacity-100')
    expect(listItem).toContain("@select.prevent=\"emit('export', conversation.id)\"")
    expect(listItem).toContain("@select.prevent=\"emit('delete', conversation.id)\"")
  })
})
