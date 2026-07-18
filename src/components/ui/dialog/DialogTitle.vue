<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { DialogTitle } from 'reka-ui'

defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <DialogTitle :class="cn('text-base font-semibold leading-none tracking-tight', $props.class)">
    <slot />
  </DialogTitle>
</template>
