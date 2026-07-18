<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Bot } from '@lucide/vue'
import Markdown from '@/components/Markdown.vue'
import { renderMarkdown } from '@/lib/markdown'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolMessage from './ToolMessage.vue'
import type { ChatMessage } from '@shared/chat'

const props = defineProps<{
  message: ChatMessage
  isActive: boolean
  thinkingActive: boolean
  isRunning: boolean
}>()

const segments = computed(() => props.message.segments ?? [])
const hasSegments = computed(() => segments.value.length > 0)

const STREAM_THROTTLE_MS = 80
const streamedHtml = ref('')
let lastRenderAt = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

function renderNow() {
  streamedHtml.value = renderMarkdown(props.message.text)
  lastRenderAt = Date.now()
}

function scheduleStreamRender() {
  if (renderTimer) return
  const wait = STREAM_THROTTLE_MS - (Date.now() - lastRenderAt)
  if (wait <= 0) {
    renderNow()
    return
  }
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderNow()
  }, wait)
}

watch(
  () => props.message.text,
  () => {
    if (props.isActive) scheduleStreamRender()
  },
  { immediate: true },
)

watch(
  () => props.isActive,
  (active) => {
    if (!active && renderTimer) {
      clearTimeout(renderTimer)
      renderTimer = null
    }
  },
)

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer)
})

function isLatestThinking(index: number): boolean {
  for (let i = segments.value.length - 1; i >= 0; i -= 1) {
    if (segments.value[i]?.type === 'thinking') return i === index
  }
  return false
}
</script>

<template>
  <div class="mr-12">
    <template v-if="hasSegments">
      <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
        <ThinkingBlock
          v-if="segment.type === 'thinking'"
          class="ml-7 mb-2"
          :content="segment.content"
          :is-active="isActive"
          :thinking-active="thinkingActive && isLatestThinking(index)"
        />
        <div v-else-if="segment.type === 'text'" class="mb-2 flex items-start gap-2.5">
          <Bot :size="18" class="mt-0.5 shrink-0 text-primary/50" />
          <div class="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
            <div v-if="isActive" class="markdown-body" v-html="renderMarkdown(segment.content)" />
            <Markdown v-else :content="segment.content" />
          </div>
        </div>
        <div v-else class="ml-7 mb-2">
          <ToolMessage :tool="segment.tool" />
        </div>
      </template>
      <div v-if="isRunning && !message.text && !message.thinking && !message.tools?.length" class="flex items-start gap-2.5">
        <Bot :size="18" class="mt-0.5 shrink-0 text-primary/50" />
        <span class="text-sm text-muted-foreground">…</span>
      </div>
    </template>
    <template v-else>
      <ThinkingBlock
        v-if="message.thinking"
        class="ml-7 mb-2"
        :content="message.thinking"
        :is-active="isActive"
        :thinking-active="thinkingActive"
      />
      <div class="flex items-start gap-2.5">
        <Bot :size="18" class="mt-0.5 shrink-0 text-primary/50" />
        <div class="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
          <div v-if="isActive && message.text" class="markdown-body" v-html="streamedHtml" />
          <Markdown v-else-if="message.text" :content="message.text" />
          <span v-else-if="isRunning" class="text-muted-foreground">…</span>
        </div>
      </div>
      <div v-if="message.tools?.length" class="ml-7 mt-2 space-y-1.5">
        <ToolMessage v-for="tool in message.tools" :key="tool.toolCallId" :tool="tool" />
      </div>
    </template>
  </div>
</template>
