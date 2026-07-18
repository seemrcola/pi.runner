<script setup lang="ts">
import { computed } from 'vue'
import { Dog, Plus, Search, Settings } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  isConnected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  isStarting: boolean
  isRunning: boolean
  cwd: string
  runtimeError: string
  conversationTitle: string
  conversationKind: 'session' | 'workspace'
}>()

const emit = defineEmits<{
  'new-conversation': []
  'command-palette': []
  pet: []
  settings: []
}>()

const contextLabel = computed(() => {
  if (props.conversationKind === 'session') return '普通会话'
  return props.cwd || '工作区'
})

const statusLabel = computed(() => {
  if (props.connectionState === 'connecting') return '正在连接'
  if (props.connectionState === 'reconnecting') return '正在重新连接'
  if (props.connectionState === 'offline') return '连接失败，自动重试'
  if (!props.isConnected) return '未连接'
  if (props.runtimeError) return '运行异常'
  if (props.isStarting) return '启动中'
  if (props.isRunning) return '运行中'
  return '空闲'
})
</script>

<template>
  <header class="app-drag flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-border px-6">
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-semibold text-foreground">
        {{ conversationTitle || '未选择会话' }}
      </div>
      <div class="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span class="truncate">{{ contextLabel }}</span>
        <span class="shrink-0">·</span>
        <span class="shrink-0">{{ statusLabel }}</span>
        <span v-if="runtimeError" class="min-w-0 truncate text-destructive" :title="runtimeError">
          {{ runtimeError }}
        </span>
      </div>
    </div>
    <div class="app-no-drag ml-auto flex shrink-0 items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-8 text-muted-foreground hover:text-foreground"
            :disabled="!isConnected"
            :title="isConnected ? '新会话' : '后端未连接'"
            aria-label="新会话"
            @click="emit('new-conversation')"
          >
            <Plus :size="14" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ isConnected ? '新会话' : '后端未连接' }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-8 text-muted-foreground hover:text-foreground"
            aria-label="搜索"
            @click="emit('command-palette')"
          >
            <Search :size="14" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>搜索</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-8 text-muted-foreground hover:text-foreground"
            aria-label="显示桌面宠物"
            @click="emit('pet')"
          >
            <Dog :size="14" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>显示桌面宠物</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-8 text-muted-foreground hover:text-foreground"
            aria-label="设置"
            @click="emit('settings')"
          >
            <Settings :size="14" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>设置</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <span
            :class="[
              'size-2 rounded-full',
              isConnected
                ? isStarting
                  ? 'bg-amber-500'
                  : isRunning
                    ? 'bg-green-500'
                    : 'bg-green-500/60'
                : 'bg-zinc-600',
            ]"
          />
        </TooltipTrigger>
        <TooltipContent>连接状态</TooltipContent>
      </Tooltip>
    </div>
  </header>
</template>
