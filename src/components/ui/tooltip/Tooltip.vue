<script setup lang="ts">
import { TooltipProvider, TooltipRoot, type TooltipProviderProps } from 'reka-ui'

const props = defineProps<TooltipProviderProps>()
</script>

<template>
  <TooltipProvider v-bind="props">
    <TooltipRoot>
      <slot />
    </TooltipRoot>
  </TooltipProvider>
</template>
