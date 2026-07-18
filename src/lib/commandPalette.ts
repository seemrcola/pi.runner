import type { Conversation } from '@shared/chat'
import type { ConversationRuntimeStatus } from '@/lib/conversationRuntime'

export type CommandPaletteActionId =
  | 'new-conversation'
  | 'start-session-only'
  | 'choose-workspace'
  | 'refresh-history'
  | 'open-settings'
  | 'switch-conversation'

export type CommandPaletteItem = {
  id: string
  title: string
  subtitle: string
  group: '操作' | '会话' | '工作区'
  keywords: string[]
  actionId: CommandPaletteActionId
  conversationId?: string
  disabled?: boolean
  disabledReason?: string
}

export type BuildCommandPaletteItemsInput = {
  conversations: Conversation[]
  conversationStatuses: Record<string, ConversationRuntimeStatus>
  isConnected: boolean
  activeTaskCount: number
  isHistorySyncing: boolean
}

export function buildCommandPaletteItems(input: BuildCommandPaletteItemsInput): CommandPaletteItem[] {
  const connectionDisabled = input.isConnected
    ? { disabled: false }
    : { disabled: true, disabledReason: '后端未连接' }
  const historyRefreshDisabled = !input.isConnected
    ? { disabled: true, disabledReason: '后端未连接' }
    : input.activeTaskCount > 0
      ? { disabled: true, disabledReason: '任务运行中' }
      : input.isHistorySyncing
        ? { disabled: true, disabledReason: '正在刷新' }
        : { disabled: false }

  const appActions: CommandPaletteItem[] = [
    {
      id: 'new-conversation',
      title: '新建会话',
      subtitle: '选择普通会话或工作区会话',
      group: '操作',
      keywords: ['new', 'conversation', 'create', '新建', '会话'],
      actionId: 'new-conversation',
      ...connectionDisabled,
    },
    {
      id: 'start-session-only',
      title: '开始普通会话',
      subtitle: '不绑定工作区',
      group: '操作',
      keywords: ['session', 'chat', '普通', '会话'],
      actionId: 'start-session-only',
      ...connectionDisabled,
    },
    {
      id: 'choose-workspace',
      title: '选择工作区',
      subtitle: '在文件夹中开始会话',
      group: '操作',
      keywords: ['workspace', 'folder', 'project', '工作区', '文件夹', '项目'],
      actionId: 'choose-workspace',
      ...connectionDisabled,
    },
    {
      id: 'refresh-history',
      title: '刷新历史',
      subtitle: '从 Pi 会话目录同步',
      group: '操作',
      keywords: ['refresh', 'sync', 'history', '刷新', '同步', '历史'],
      actionId: 'refresh-history',
      ...historyRefreshDisabled,
    },
    {
      id: 'open-settings',
      title: '打开设置',
      subtitle: 'Pi 安装、模型和本地 skills',
      group: '操作',
      keywords: ['settings', 'models', 'skills', '设置', '模型'],
      actionId: 'open-settings',
      disabled: false,
    },
  ]

  return [
    ...appActions,
    ...input.conversations.map((conversation) => conversationItem(conversation, input.conversationStatuses[conversation.id] ?? 'idle')),
  ]
}

export function filterCommandPaletteItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (terms.length === 0) return items

  return items.filter((item) => {
    const haystack = normalizeSearchText([
      item.title,
      item.subtitle,
      item.group,
      item.actionId,
      ...item.keywords,
    ].join(' '))
    return terms.every((term) => haystack.includes(term))
  })
}

function conversationItem(conversation: Conversation, status: ConversationRuntimeStatus): CommandPaletteItem {
  const isWorkspace = conversation.kind === 'workspace'
  const workspacePath = conversation.workspacePath ?? ''
  return {
    id: `switch:${conversation.id}`,
    title: conversation.title || '未命名会话',
    subtitle: isWorkspace ? workspacePath || '工作区' : '普通会话',
    group: isWorkspace ? '工作区' : '会话',
    keywords: [
      'switch',
      'conversation',
      '打开',
      '切换',
      status,
      statusLabel(status),
      conversation.title,
      workspacePath,
      conversation.workspaceDirName ?? '',
    ],
    actionId: 'switch-conversation',
    conversationId: conversation.id,
    disabled: false,
  }
}

function statusLabel(status: ConversationRuntimeStatus): string {
  switch (status) {
    case 'starting':
      return '启动中'
    case 'running':
      return '运行中'
    case 'stopping':
      return '停止中'
    case 'error':
      return '异常'
    case 'idle':
      return '空闲'
  }
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}
