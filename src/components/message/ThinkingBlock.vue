<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Brain, ChevronDown, ChevronRight } from '@lucide/vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  content: string
  /** 是否为当前正在流式输出的消息 */
  isActive: boolean
  /** 是否正在输出思考内容 */
  thinkingActive: boolean
}>()

// 用户手动展开的集合归本组件自己管；流式期间自动展开
const manualExpanded = ref(false)

// 流式输出开始时，自动展开；结束后自动收起（用户可再次手动展开）
watch(
  () => props.thinkingActive && props.isActive,
  (streaming) => {
    if (streaming) manualExpanded.value = true
    else if (props.isActive) manualExpanded.value = false
  },
)

const expanded = computed(
  () => (props.isActive && props.thinkingActive) || manualExpanded.value,
)

function setExpanded(value: boolean) {
  // 思考进行中时禁止手动收起当前消息的思考块
  if (props.isActive && props.thinkingActive && !value) return
  manualExpanded.value = value
}
</script>

<template>
  <Collapsible
    :open="expanded"
    class="mb-2 overflow-hidden rounded-sm border border-border bg-card"
    @update:open="setExpanded"
  >
    <CollapsibleTrigger as-child>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-none px-3 py-1.5 text-xs font-bold text-blue-400 hover:bg-accent hover:text-blue-400"
      >
        <Brain :size="12" :class="isActive && thinkingActive ? 'animate-pulse' : ''" />
        <span>thinking</span>
        <span v-if="isActive && thinkingActive" class="text-[10px] font-normal text-muted-foreground">…</span>
        <ChevronDown v-if="expanded" :size="12" class="ml-auto text-muted-foreground" />
        <ChevronRight v-else :size="12" class="ml-auto text-muted-foreground" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre
        class="whitespace-pre-wrap break-words border-t border-border px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground"
      >{{ content }}</pre>
    </CollapsibleContent>
  </Collapsible>
</template>
