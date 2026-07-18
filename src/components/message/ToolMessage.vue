<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Terminal } from '@lucide/vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import {
  detailArgsForTool,
  extractWriteContent,
  shouldDefaultExpandTool,
} from '@/lib/toolDisplay'
import type { ToolMeta } from '@shared/chat'

const props = defineProps<{ tool: ToolMeta }>()

const expanded = ref(shouldDefaultExpandTool(props.tool))
const userToggled = ref(false)

const fullToolName = computed(() => props.tool.toolName.trim())

const summaryTitle = computed(() => {
  const firstLine = fullToolName.value.split(/\r?\n/).find((line) => line.trim())
  return firstLine?.trim() || 'tool'
})

const showsToolNameDetail = computed(
  () => fullToolName.value.length > summaryTitle.value.length || fullToolName.value !== summaryTitle.value,
)

const diffLines = computed(() => props.tool.diff?.split(/\r?\n/) ?? [])
const writeContent = computed(() => extractWriteContent(props.tool))
const detailArgs = computed(() => detailArgsForTool(props.tool))

const hasDetails = computed(
  () => showsToolNameDetail.value
    || detailArgs.value != null
    || writeContent.value != null
    || Boolean(props.tool.output)
    || Boolean(props.tool.diff)
    || props.tool.result != null,
)

function statusColor(status: ToolMeta['status']) {
  return status === 'running'
    ? 'text-primary'
    : status === 'done'
      ? 'text-green-500'
      : 'text-destructive'
}

function formatDetail(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function diffLineClass(line: string) {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-emerald-500/10 text-emerald-300'
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-500/10 text-red-300'
  return 'text-muted-foreground'
}

watch(
  () => shouldDefaultExpandTool(props.tool),
  (shouldExpand) => {
    if (!userToggled.value && shouldExpand) expanded.value = true
  },
)

function updateExpanded(value: boolean) {
  userToggled.value = true
  expanded.value = value
}
</script>

<template>
  <Collapsible :open="expanded" @update:open="updateExpanded">
    <CollapsibleTrigger as-child>
      <Button
        variant="outline"
        class="h-auto min-w-0 w-full items-center justify-between rounded-sm bg-card px-3 py-2 hover:border-muted-foreground/30 hover:bg-card"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <Terminal :size="14" :class="['shrink-0', statusColor(tool.status)]" />
          <span :class="['min-w-0 truncate text-left font-mono text-[13px] font-semibold', statusColor(tool.status)]">
            {{ summaryTitle }}
          </span>
        </span>
        <ChevronDown v-if="expanded" :size="14" class="shrink-0 text-muted-foreground" />
        <ChevronRight v-else :size="14" class="shrink-0 text-muted-foreground" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent class="overflow-hidden rounded-b-sm border border-t-0 border-border bg-zinc-950/50">
      <pre
        v-if="showsToolNameDetail"
        class="border-b border-border/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
      >command: {{ fullToolName }}</pre>
      <pre
        v-if="detailArgs != null"
        class="border-b border-border/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
      >args: {{ formatDetail(detailArgs) }}</pre>
      <div
        v-if="writeContent != null"
        class="border-b border-border/50 px-3 py-2.5 font-mono text-xs leading-relaxed"
      >
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">content</div>
        <pre class="overflow-x-auto whitespace-pre text-muted-foreground"><code>{{ writeContent }}</code></pre>
      </div>
      <pre
        v-if="tool.output"
        class="border-b border-border/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
      >output: {{ tool.output }}</pre>
      <div
        v-if="tool.diff"
        class="border-b border-border/50 px-3 py-2.5 font-mono text-xs leading-relaxed"
      >
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">diff</div>
        <pre class="overflow-x-auto whitespace-pre"><code><span
          v-for="(line, index) in diffLines"
          :key="index"
          :class="['block min-h-4 px-1', diffLineClass(line)]"
        >{{ line || ' ' }}</span></code></pre>
      </div>
      <pre
        v-if="tool.result != null"
        class="px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
      >result: {{ formatDetail(tool.result) }}</pre>
      <div
        v-if="!hasDetails"
        class="px-3 py-2.5 text-xs text-muted-foreground"
      >No details available.</div>
    </CollapsibleContent>
  </Collapsible>
</template>
