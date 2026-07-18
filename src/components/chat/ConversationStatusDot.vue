<script setup lang="ts">
import type { ConversationRuntimeStatus } from '@/lib/conversationRuntime'

const props = defineProps<{
  status: ConversationRuntimeStatus
}>()

const statusClasses: Record<ConversationRuntimeStatus, string> = {
  idle: 'bg-transparent',
  running: 'bg-primary',
  stopping: 'bg-amber-400',
  starting: 'bg-amber-400',
  error: 'bg-destructive',
}

const ringClasses: Record<ConversationRuntimeStatus, string> = {
  idle: 'border-muted-foreground/20',
  running: 'border-primary/50',
  stopping: 'border-amber-400/50',
  starting: 'border-amber-400/50',
  error: 'border-destructive/50',
}

const statusLabels: Record<ConversationRuntimeStatus, string> = {
  idle: '空闲',
  running: '运行中',
  stopping: '停止中',
  starting: '启动中',
  error: '异常',
}
</script>

<template>
  <span class="relative flex size-3.5 shrink-0 items-center justify-center" :title="statusLabels[status]">
    <span
      v-if="status !== 'idle'"
      :class="[
        'absolute inset-0 rounded-full border opacity-70 animate-ping',
        ringClasses[status],
      ]"
    />
    <span
      :class="[
        'relative size-2 rounded-full',
        statusClasses[status],
      ]"
    />
  </span>
</template>
