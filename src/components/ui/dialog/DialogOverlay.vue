<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { DialogOverlay } from 'reka-ui'

defineOptions({
  inheritAttrs: false,
})

defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    v-bind="$attrs"
    :class="cn('fixed inset-0 z-50 bg-background/75 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', $props.class)"
  />
</template>
