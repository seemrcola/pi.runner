<script setup lang="ts">
import { computed, ref } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AgentTurn, ChatMessage } from '@shared/chat'

const props = defineProps<{
  messages: ChatMessage[]
  turns: AgentTurn[]
}>()

const emit = defineEmits<{
  select: [messageId: string]
}>()

const hoveredTurnId = ref<string | null>(null)

type TimelineTurn = {
  id: string
  messageId: string
  questionPreview: string
  answerPreview: string
  toolCount: number
  isActive: boolean
}

const turns = computed<TimelineTurn[]>(() => {
  const messageById = new Map(props.messages.map((message) => [message.id, message]))

  const items = props.turns.map((turn) => {
    const messages = turn.messageIds
      .map((messageId) => messageById.get(messageId))
      .filter((message): message is ChatMessage => Boolean(message))
    const question = messages.find((message) => message.role === 'user')
    const assistant = messages.find((message) => message.role === 'assistant')
    return {
      id: turn.id,
      messageId: messages[0]?.id ?? turn.id,
      questionPreview: previewText(question?.text ?? '', '新回合'),
      answerPreview: previewText(assistant?.text || assistant?.thinking || '', '正在回复'),
      toolCount: messages.reduce((total, message) => total + (message.role === 'assistant' ? message.tools?.length ?? 0 : 0), 0),
      isActive: false,
    }
  })

  if (items.length > 0) {
    items[items.length - 1].isActive = true
  }

  return items
})

const hoveredTurn = computed(() =>
  turns.value.find((turn) => turn.id === hoveredTurnId.value) ?? null,
)

const hoveredTurnIndex = computed(() =>
  turns.value.findIndex((turn) => turn.id === hoveredTurnId.value),
)

function markerStyle(index: number, turn: TimelineTurn) {
  const hoveredIndex = hoveredTurnIndex.value
  const baseHeight = 2
  const baseWidth = turn.isActive ? 14 : 10
  if (hoveredIndex < 0) {
    return {
      height: `${baseHeight}px`,
      width: `${baseWidth}px`,
    }
  }

  const distance = Math.abs(index - hoveredIndex)
  const sigma = 1.15
  const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma))
  return {
    height: `${baseHeight}px`,
    width: `${baseWidth + 14 * weight}px`,
  }
}

function previewText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized
}
</script>

<template>
  <nav
    class="absolute left-0 top-1/2 z-20 hidden -translate-y-1/2 overflow-visible py-1 md:block"
    aria-label="会话时间线"
    @mouseleave="hoveredTurnId = null"
  >
    <ScrollArea class="max-h-[min(420px,60vh)]" viewport-class="pr-1">
      <div v-if="turns.length === 0" class="flex flex-col items-center gap-0.5 px-1 opacity-35">
        <span class="h-0.5 w-4 rounded-full bg-border" />
        <span class="h-0.5 w-3 rounded-full bg-border" />
        <span class="h-0.5 w-2 rounded-full bg-border" />
      </div>

      <ol v-else class="flex flex-col items-center gap-0">
        <li
          v-for="(turn, index) in turns"
          :key="turn.id"
          class="relative flex flex-col items-center"
          @mouseenter="hoveredTurnId = turn.id"
          @focusin="hoveredTurnId = turn.id"
        >
          <button
            type="button"
            class="relative z-10 flex h-2 w-6 items-center justify-start rounded-sm text-muted-foreground transition-[background-color,color] duration-200 ease-out hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            :aria-label="`跳转到第 ${index + 1} 个回合`"
            @click="emit('select', turn.messageId)"
          >
            <span
              :class="[
                'block rounded-full transition-[width,background-color] duration-200 ease-out',
                turn.isActive
                  ? 'bg-primary'
                  : hoveredTurnId
                    ? 'bg-primary/75'
                    : 'bg-muted-foreground/45',
              ]"
              :style="markerStyle(index, turn)"
            />
          </button>
        </li>
      </ol>
    </ScrollArea>

    <div
      v-if="hoveredTurn"
      class="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-30 w-[min(420px,calc(100vw-360px))] -translate-y-1/2 rounded-md border border-border bg-popover px-3 py-2.5 text-popover-foreground opacity-100 shadow-lg transition-[opacity,transform] duration-150 ease-out"
    >
      <div class="mb-1 truncate text-sm font-semibold">{{ hoveredTurn.questionPreview }}</div>
      <p class="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {{ hoveredTurn.answerPreview || '暂无回复' }}
      </p>
      <div v-if="hoveredTurn.toolCount > 0" class="mt-2 text-[10px] font-medium uppercase text-primary/80">
        {{ hoveredTurn.toolCount }} 次工具调用
      </div>
    </div>
  </nav>
</template>
