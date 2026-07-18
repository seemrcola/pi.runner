<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, FolderOpen, MessageCircle, MoreHorizontal, Pin, PinOff, RotateCcw, Trash2, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ConversationListItem from './ConversationListItem.vue'
import { groupConversationsByWorkspace, toggleWorkspaceExpanded } from '@/lib/sidebarGroups'
import {
  buildWorkspaceSidebarGroups,
  toggleWorkspacePinned,
} from '@/lib/workspaceSidebar'
import type { ConversationRuntimeStatus } from '@/lib/conversationRuntime'
import type { Conversation } from '@shared/chat'
import type { WorkspaceViewState } from '@shared/protocol'

const props = defineProps<{
  conversations: Conversation[]
  activeId: string | null
  isConnected: boolean
  activeTaskCount: number
  isHistorySyncing: boolean
  showAddDialog: boolean
  expandedWorkspaces: ReadonlySet<string>
  workspaceViewStates: ReadonlyMap<string, WorkspaceViewState>
  conversationStatuses?: Record<string, ConversationRuntimeStatus>
}>()

const emit = defineEmits<{
  chooseWorkspace: []
  startSessionOnly: []
  closeAddDialog: []
  select: [id: string]
  export: [id: string]
  delete: [id: string]
  deleteWorkspace: [workspacePath: string]
  openWorkspaceFolder: [workspacePath: string]
  addWorkspaceConversation: [workspacePath: string]
  updateExpandedWorkspaces: [expandedWorkspaces: Set<string>]
  updateWorkspaceViewState: [workspacePath: string, patch: { isPinned?: boolean; isCollapsed?: boolean }]
  refreshHistory: []
}>()

const sidebarRoot = ref<HTMLElement | null>(null)

function statusFor(conversationId: string): ConversationRuntimeStatus {
  return props.conversationStatuses?.[conversationId] ?? 'idle'
}

function isTaskActive(status: ConversationRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'stopping'
}

const workspaceGroups = computed(() => {
  const groups = groupConversationsByWorkspace(props.conversations, props.expandedWorkspaces)
  return buildWorkspaceSidebarGroups(
    groups.filter((group) => group.workspacePath !== 'Session'),
    {
      pinnedWorkspaces: pinnedWorkspaces.value,
    },
  ).map((group) => ({
    ...group,
    activeTaskCount: group.conversations.filter((conversation) => {
      const status = statusFor(conversation.id)
      return isTaskActive(status)
    }).length,
  }))
})

const sessionGroup = computed(() =>
  props.conversations.filter((conversation) => conversation.kind === 'session'),
)

watch(
  () => [props.activeId, props.expandedWorkspaces, props.conversations] as const,
  () => {
    nextTick(scrollActiveConversationIntoView)
  },
  { flush: 'post' },
)

function selectConversation(id: string) {
  emit('select', id)
}

function exportConversation(id: string) {
  emit('export', id)
}

function deleteConversation(id: string) {
  emit('delete', id)
}

function toggleWorkspace(workspacePath: string) {
  const next = toggleWorkspaceExpanded(props.expandedWorkspaces, workspacePath)
  emit('updateExpandedWorkspaces', next)
  emit('updateWorkspaceViewState', workspacePath, { isCollapsed: !next.has(workspacePath) })
}

function addWorkspaceConversation(workspacePath: string) {
  emit('addWorkspaceConversation', workspacePath)
}

function toggleWorkspacePin(workspacePath: string) {
  const next = toggleWorkspacePinned(pinnedWorkspaces.value, workspacePath)
  emit('updateWorkspaceViewState', workspacePath, { isPinned: next.has(workspacePath) })
}

function openWorkspaceFolder(workspacePath: string) {
  emit('openWorkspaceFolder', workspacePath)
}

function removeWorkspace(workspacePath: string) {
  emit('deleteWorkspace', workspacePath)
  if (pinnedWorkspaces.value.has(workspacePath)) {
    emit('updateWorkspaceViewState', workspacePath, { isPinned: false })
  }
}

const pinnedWorkspaces = computed(() => {
  const pinned = new Set<string>()
  for (const state of props.workspaceViewStates.values()) {
    if (state.isPinned) pinned.add(state.workspacePath)
  }
  return pinned
})

function scrollActiveConversationIntoView() {
  if (!props.activeId) return
  const activeItem = sidebarRoot.value?.querySelector<HTMLElement>('[data-active-conversation="true"]')
  activeItem?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <aside ref="sidebarRoot" class="flex min-h-0 flex-col overflow-hidden bg-card">
    <div class="app-drag flex h-14 shrink-0 items-center border-b border-border pl-24 pr-4">
      <div class="app-no-drag flex min-w-0 items-center gap-2.5" aria-label="Pi RUNNER">
        <!-- <img src="/app-icon.png" alt="" class="size-5 shrink-0 rounded-sm" aria-hidden="true" /> -->
        <span class="sidebar-wordmark">
          <span class="sidebar-wordmark-runner">Pi RUNNER</span>
        </span>
      </div>
    </div>
    <div class="flex h-10 shrink-0 items-center border-b border-border px-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="app-no-drag h-8 w-full justify-start gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="!isConnected || activeTaskCount > 0 || isHistorySyncing"
            aria-label="同步历史"
            :title="!isConnected ? '后端未连接' : activeTaskCount > 0 ? '任务运行中，无法同步历史' : isHistorySyncing ? '正在同步历史' : '同步历史'"
            @click="emit('refreshHistory')"
          >
            <RotateCcw :class="['size-3.5', isHistorySyncing && 'animate-spin']" />
            同步历史
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ !isConnected ? '后端未连接' : activeTaskCount > 0 ? '任务运行中，无法同步历史' : isHistorySyncing ? '正在同步历史' : '从 Pi 会话目录同步会话和工作区历史' }}
        </TooltipContent>
      </Tooltip>
    </div>

    <Dialog :open="showAddDialog" @update:open="(open) => !open && emit('closeAddDialog')">
      <DialogContent class="rounded-sm">
        <DialogHeader class="pr-8">
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription class="sr-only">选择普通会话或工作区会话</DialogDescription>
        </DialogHeader>

        <DialogClose
          class="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="关闭弹窗"
        >
          <X class="size-4" />
        </DialogClose>

        <div class="space-y-2">
          <p v-if="!isConnected" class="pb-1 text-xs text-muted-foreground">连接后可开始会话</p>
          <Button
            class="w-full justify-start"
            variant="secondary"
            :disabled="!isConnected"
            @click="emit('chooseWorkspace')"
          >
            <FolderOpen class="mr-2 size-4" />
            在工作区开始
          </Button>
          <Button
            class="w-full justify-start"
            variant="secondary"
            :disabled="!isConnected"
            @click="emit('startSessionOnly')"
          >
            <MessageCircle class="mr-2 size-4" />
            开始普通会话
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <ScrollArea class="min-h-0 flex-1">
      <div class="space-y-4 p-2">
        <section>
          <div class="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">会话</div>
          <div v-if="sessionGroup.length" class="space-y-0.5">
            <ConversationListItem
              v-for="conv in sessionGroup"
              :key="conv.id"
              :conversation="conv"
              :is-active="conv.id === activeId"
              :status="statusFor(conv.id)"
              :can-remove="!isTaskActive(statusFor(conv.id))"
              @select="selectConversation"
              @export="exportConversation"
              @delete="deleteConversation"
            />
          </div>
          <div v-else class="px-2 py-2 text-xs text-muted-foreground">暂无会话</div>
        </section>

        <section>
          <div class="px-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            工作区
          </div>
          <div v-if="workspaceGroups.length" class="space-y-2">
            <div v-for="group in workspaceGroups" :key="group.workspacePath">
              <div
                :class="[
                  'group/workspace flex w-full items-center gap-1.5 rounded-sm px-2 py-1 transition-colors hover:bg-accent',
                  group.isPinned && 'bg-primary/5 ring-1 ring-primary/10',
                ]"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  :aria-expanded="!group.isCollapsed"
                  :title="group.workspacePath"
                  @click="toggleWorkspace(group.workspacePath)"
                >
                  <ChevronRight
                    :class="[
                      'size-3.5 shrink-0 text-muted-foreground transition-transform',
                      !group.isCollapsed && 'rotate-90',
                    ]"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span :class="['truncate text-[11px] font-semibold uppercase', group.isPinned ? 'text-foreground' : 'text-muted-foreground']">
                        {{ group.label }}
                      </span>
                      <span
                        v-if="group.isPinned"
                        class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary"
                      >
                        置顶
                      </span>
                    </div>
                  </div>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger as-child @click.stop>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="shrink-0 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="工作区操作"
                      aria-label="工作区操作"
                    >
                      <MoreHorizontal class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" class="w-44">
                    <DropdownMenuItem
                      :disabled="!isConnected"
                      @select.prevent="addWorkspaceConversation(group.workspacePath)"
                    >
                      <span class="size-4 text-center text-base leading-none">+</span>
                      <span>新建会话</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem @select.prevent="toggleWorkspacePin(group.workspacePath)">
                      <Pin v-if="!group.isPinned" class="size-4" />
                      <PinOff v-else class="size-4" />
                      <span>{{ group.isPinned ? '取消置顶' : '置顶' }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @select.prevent="openWorkspaceFolder(group.workspacePath)"
                    >
                      <FolderOpen class="size-4" />
                      <span>打开文件夹</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      :disabled="group.activeTaskCount > 0"
                      @select.prevent="removeWorkspace(group.workspacePath)"
                    >
                      <Trash2 class="size-4" />
                      <span v-if="group.activeTaskCount > 0">
                        工作区有 {{ group.activeTaskCount }} 个任务进行中
                      </span>
                      <span v-else>移除工作区</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div v-show="!group.isCollapsed" class="mt-1 space-y-0.5">
                <ConversationListItem
                  v-for="conv in group.conversations"
                  :key="conv.id"
                  :conversation="conv"
                  :is-active="conv.id === activeId"
                  :status="statusFor(conv.id)"
                  :can-remove="!isTaskActive(statusFor(conv.id))"
                  @select="selectConversation"
                  @export="exportConversation"
                  @delete="deleteConversation"
                />
              </div>
            </div>
          </div>
          <div v-else class="px-2 py-2 text-xs text-muted-foreground">暂无工作区</div>
        </section>
      </div>
    </ScrollArea>
  </aside>
</template>
