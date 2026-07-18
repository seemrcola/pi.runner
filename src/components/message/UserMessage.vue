<script setup lang="ts">
import { computed } from 'vue'
import { ImageThumbnailList } from '../image-viewer'
import { toImageViewerItems } from '@/lib/chatImageViewer'
import type { ImageViewerItem } from '@/lib/imageViewerState'
import type { ChatMessage } from '@shared/chat'

const props = defineProps<{ message: ChatMessage }>()
const emit = defineEmits<{
  'open-image-viewer': [images: ImageViewerItem[], index: number, trigger: HTMLButtonElement]
}>()

const streamingBehavior = computed(() => {
  const value = props.message.meta && 'streamingBehavior' in props.message.meta
    ? props.message.meta.streamingBehavior
    : undefined
  return value
})

const imageItems = computed(() => toImageViewerItems(props.message.images ?? [], '用户附加图片'))

function openImageViewer(images: ImageViewerItem[], index: number, trigger: HTMLButtonElement) {
  emit('open-image-viewer', images, index, trigger)
}
</script>

<template>
  <div class="flex justify-end">
    <div class="flex max-w-[80%] flex-col items-end gap-1">
      <ImageThumbnailList
        v-if="imageItems.length"
        :images="imageItems"
        aria-label="用户附加图片列表"
        @open="openImageViewer"
      />
      <div
        v-if="message.text"
        class="whitespace-pre-wrap break-words rounded-sm rounded-br-none bg-secondary px-4 py-2.5 text-sm text-secondary-foreground"
      >
        {{ message.text }}
      </div>
      <div
        v-if="streamingBehavior"
        class="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
        :title="streamingBehavior === 'followUp' ? 'Agent 停止后发送' : '下一次模型调用前生效'"
      >
        {{ streamingBehavior === 'followUp' ? '后续' : '引导' }}
      </div>
    </div>
  </div>
</template>
