<script setup lang="ts">
import type { ChatMessage } from '@shared/chat'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <div class="mr-12">
    <div
      class="rounded-sm border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive whitespace-pre-wrap break-words"
    >
      {{ message.text }}
    </div>
  </div>
</template>
