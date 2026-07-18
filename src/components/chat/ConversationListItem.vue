<script setup lang="ts">
import { computed } from 'vue'
import { Download, MoreHorizontal, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ConversationRuntimeStatus } from '@/lib/conversationRuntime'
import type { Conversation } from '@shared/chat'
import ConversationStatusDot from './ConversationStatusDot.vue'

const props = defineProps<{
  conversation: Conversation
  isActive: boolean
  status: ConversationRuntimeStatus
  canRemove: boolean
}>()

const isTemporaryDraft = computed(() => (
  props.conversation.sessionPath === null && props.conversation.messages.length === 0
))

const emit = defineEmits<{
  select: [id: string]
  export: [id: string]
  delete: [id: string]
}>()
</script>

<template>
  <div
    :data-active-conversation="isActive ? 'true' : undefined"
    :class="[
      'group/item flex h-8 items-center gap-1.5 rounded-sm transition-colors hover:bg-accent',
      isActive && 'bg-accent',
    ]"
  >
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      :aria-current="isActive ? 'page' : undefined"
      @click="emit('select', conversation.id)"
    >
      <ConversationStatusDot :status="status" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <div :class="['truncate text-[12px] font-medium', isActive ? 'text-primary' : 'text-foreground']">
            {{ conversation.title }}
          </div>
          <span
            v-if="isTemporaryDraft"
            class="shrink-0 rounded bg-secondary px-1 py-0.5 text-[9px] font-medium text-muted-foreground"
            title="仅保存在当前窗口，发送第一条消息后才会持久化"
          >草稿</span>
        </div>
      </div>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child @click.stop>
        <Button
          variant="ghost"
          size="icon-sm"
          class="mr-0.5 size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
          title="会话操作"
          aria-label="会话操作"
        >
          <MoreHorizontal class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-32">
        <DropdownMenuItem @select.prevent="emit('export', conversation.id)">
          <Download class="size-4" />
          <span>导出</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          :disabled="!canRemove"
          @select.prevent="emit('delete', conversation.id)"
        >
          <Trash2 class="size-4" />
          <span>{{ canRemove ? '移除' : '任务进行中，停止后才能移除' }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
