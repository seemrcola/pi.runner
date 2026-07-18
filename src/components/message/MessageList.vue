<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Bot } from '@lucide/vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import UserMessage from './UserMessage.vue'
import AssistantMessage from './AssistantMessage.vue'
import SystemMessage from './SystemMessage.vue'
import ErrorMessage from './ErrorMessage.vue'
import { shouldShowModelWorkingStatus } from '@/lib/messageWorkingStatus'
import type { AgentTurn, ChatMessage } from '@shared/chat'
import type { ImageViewerItem } from '@/lib/imageViewerState'

const props = defineProps<{
  messages: ChatMessage[]
  turns: AgentTurn[]
  /** 整体是否处于运行态 */
  isRunning: boolean
}>()

const emit = defineEmits<{
  'open-image-viewer': [images: ImageViewerItem[], index: number, trigger: HTMLButtonElement]
}>()

function openImageViewer(images: ImageViewerItem[], index: number, trigger: HTMLButtonElement) {
  emit('open-image-viewer', images, index, trigger)
}

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const highlightedMessageId = ref<string | null>(null)
let highlightTimer: number | null = null

function scrollElement() {
  return scrollAreaRef.value?.viewportElement()
}

// 运行状态来自 backend runner snapshot；streaming 状态覆盖短暂的事件间隙。
const showModelWorkingStatus = computed(() =>
  shouldShowModelWorkingStatus(props.messages, props.isRunning),
)

// 距离底部多近视为“已贴底”（px）。在此范围内自动跟随，向上滚出该范围则暂停自动滚动。
const STICK_THRESHOLD = 80
// 用户是否贴在底部。流式更新只在贴底时才自动滚动，避免打断用户向上翻阅历史。
const isPinned = ref(true)

function onScroll() {
  const el = scrollElement()
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
  isPinned.value = distanceFromBottom <= STICK_THRESHOLD
}

/** 贴底时才滚动；用户已向上滚动则不打断。用于流式 / 工具 / 系统消息等被动更新。 */
function scrollToBottom() {
  nextTick(() => {
    const el = scrollElement()
    if (!el || !isPinned.value) return
    el.scrollTop = el.scrollHeight
  })
}

/** 强制贴底并滚动到底。用于用户主动发送消息、切换会话等需要跟随的场景。 */
function forceScrollToBottom() {
  isPinned.value = true
  nextTick(() => {
    const el = scrollElement()
    if (el) el.scrollTop = el.scrollHeight
  })
}

function scrollToMessage(messageId: string) {
  nextTick(() => {
    const el = scrollElement()
    if (!el) return
    const target = [...el.querySelectorAll<HTMLElement>('[data-message-id]')]
      .find((item) => item.dataset.messageId === messageId)
    if (!target) return

    isPinned.value = false
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlightedMessageId.value = messageId
    if (highlightTimer != null) window.clearTimeout(highlightTimer)
    highlightTimer = window.setTimeout(() => {
      highlightedMessageId.value = null
      highlightTimer = null
    }, 1400)
  })
}

onBeforeUnmount(() => {
  if (highlightTimer != null) window.clearTimeout(highlightTimer)
})

defineExpose({ scrollToBottom, forceScrollToBottom, scrollToMessage })
</script>

<template>
  <ScrollArea
    ref="scrollAreaRef"
    class="min-w-0 flex-1"
    viewport-class="px-10 py-6"
    @scroll="onScroll"
  >
    <div v-if="props.messages.length === 0" class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Bot :size="36" class="opacity-25" />
      <p class="text-sm opacity-70">发送一条消息开始</p>
    </div>

    <div
      v-for="msg in props.messages"
      :key="msg.id"
      :data-message-id="msg.id"
      :class="[
        'mb-4 min-w-0 rounded-sm transition-[background-color,box-shadow] duration-200',
        highlightedMessageId === msg.id ? 'bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]' : '',
      ]"
    >
      <UserMessage
        v-if="msg.role === 'user'"
        :message="msg"
        @open-image-viewer="openImageViewer"
      />
      <AssistantMessage
        v-else-if="msg.role === 'assistant' && msg.status === 'streaming'"
        :message="msg"
        :is-active="true"
        :thinking-active="msg.thinkingActive === true"
        :is-running="props.isRunning"
      />
      <AssistantMessage
        v-else-if="msg.role === 'assistant'"
        :message="msg"
        :is-active="false"
        :thinking-active="msg.thinkingActive === true"
        :is-running="false"
      />
      <SystemMessage v-else-if="msg.role === 'system'" :message="msg" />
      <ErrorMessage v-else-if="msg.role === 'error'" :message="msg" />
    </div>

    <div
      v-if="showModelWorkingStatus"
      data-testid="agent-working-status"
      class="ml-7 mt-1 flex items-center gap-2 pb-2 text-xs text-muted-foreground"
    >
      <span class="relative flex size-2 shrink-0">
        <span class="absolute inline-flex size-full animate-ping rounded-full bg-primary/35" />
        <span class="relative inline-flex size-2 rounded-full bg-primary/75" />
      </span>
      <span>Pi 仍在工作...</span>
    </div>
  </ScrollArea>
</template>
