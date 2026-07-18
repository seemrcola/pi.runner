<script setup lang="ts">
import { TooltipContent, TooltipArrow, TooltipPortal } from 'reka-ui'
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      side="bottom"
      align="center"
      :side-offset="8"
      class="z-50 overflow-hidden rounded-sm border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
    >
      <slot />
      <TooltipArrow class="fill-border" :width="8" :height="4" />
    </TooltipContent>
  </TooltipPortal>
</template>
