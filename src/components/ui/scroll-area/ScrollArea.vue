<script setup lang="ts">
import type { ScrollAreaRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ref } from "vue"
import { reactiveOmit } from "@/lib/vueUse"
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
} from "reka-ui"
import { cn } from "@/lib/utils"
import ScrollBar from "./ScrollBar.vue"

const props = defineProps<ScrollAreaRootProps & {
  class?: HTMLAttributes["class"]
  viewportClass?: HTMLAttributes["class"]
  horizontal?: boolean
}>()

const emit = defineEmits<{
  scroll: [event: Event]
}>()

const delegatedProps = reactiveOmit(props, "class", "viewportClass", "horizontal")
const rootRef = ref<InstanceType<typeof ScrollAreaRoot> | null>(null)

/** 业务滚动逻辑必须读取 Reka viewport，而不是不滚动的 ScrollAreaRoot。 */
function viewportElement() {
  return rootRef.value?.viewport
}

defineExpose({ viewportElement })
</script>

<template>
  <ScrollAreaRoot
    ref="rootRef"
    data-slot="scroll-area"
    v-bind="delegatedProps"
    :class="cn('relative', props.class)"
  >
    <ScrollAreaViewport
      data-slot="scroll-area-viewport"
      :class="cn('size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1', props.viewportClass)"
      @scroll.passive="emit('scroll', $event)"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollBar v-if="horizontal" orientation="horizontal" />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
