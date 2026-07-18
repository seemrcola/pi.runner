<script setup lang="ts">
import type { ChatMessage } from '@shared/chat'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <div class="mr-12">
    <pre
      class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground/60"
    >{{ message.text }}</pre>
  </div>
</template>
