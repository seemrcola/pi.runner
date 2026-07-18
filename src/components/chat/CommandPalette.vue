<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CheckCircle2, Circle, Command, FolderOpen, MessageCircle, RotateCcw, Search, Settings } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { filterCommandPaletteItems, type CommandPaletteItem } from '@/lib/commandPalette'

const props = defineProps<{
  open: boolean
  items: CommandPaletteItem[]
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [item: CommandPaletteItem]
}>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const visibleItems = computed(() => filterCommandPaletteItems(props.items, query.value))
const activeItem = computed(() => visibleItems.value[activeIndex.value] ?? null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  },
)

watch(visibleItems, () => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(visibleItems.value.length - 1, 0))
})

function close() {
  emit('update:open', false)
}

function selectItem(item: CommandPaletteItem | null) {
  if (!item || item.disabled) return
  emit('select', item)
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(activeItem.value)
  }
}

function moveActive(delta: number) {
  const count = visibleItems.value.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function iconFor(item: CommandPaletteItem) {
  switch (item.actionId) {
    case 'new-conversation':
    case 'start-session-only':
    case 'switch-conversation':
      return MessageCircle
    case 'choose-workspace':
      return FolderOpen
    case 'refresh-history':
      return RotateCcw
    case 'open-settings':
      return Settings
  }
}

function statusIcon(item: CommandPaletteItem) {
  if (item.disabled) return Circle
  return CheckCircle2
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="top-[14vh] max-w-[min(620px,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden p-0">
      <div class="sr-only">
        <DialogTitle>命令面板</DialogTitle>
        <DialogDescription>搜索并执行常用操作或切换会话</DialogDescription>
      </div>

      <div class="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search class="size-4 shrink-0 text-muted-foreground" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/55"
          placeholder="搜索会话、工作区或操作"
          spellcheck="false"
          @keydown="onKeydown"
        />
        <div class="hidden shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:flex">
          <Command class="size-3" />
          K
        </div>
      </div>

      <ScrollArea class="max-h-[min(480px,70vh)]" viewport-class="p-2">
        <div v-if="visibleItems.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
          没有匹配项
        </div>

        <button
          v-for="(item, index) in visibleItems"
          :key="item.id"
          type="button"
          :disabled="item.disabled"
          :class="[
            'flex h-12 w-full min-w-0 items-center gap-3 rounded-sm px-3 text-left transition-colors',
            index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/70',
            item.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
          ]"
          @mouseenter="activeIndex = index"
          @click="selectItem(item)"
        >
          <component :is="iconFor(item)" class="size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{{ item.title }}</div>
            <div class="mt-0.5 truncate text-xs text-muted-foreground">
              {{ item.disabled ? item.disabledReason : item.subtitle }}
            </div>
          </div>
          <span class="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {{ item.group }}
          </span>
          <component
            :is="statusIcon(item)"
            :class="[
              'size-3.5 shrink-0',
              item.disabled ? 'text-muted-foreground' : 'text-primary/80',
            ]"
          />
        </button>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
