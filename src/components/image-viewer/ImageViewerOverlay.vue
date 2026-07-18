<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, ImageOff, X } from '@lucide/vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ImageViewerItem } from '@/lib/imageViewerState'

const props = defineProps<{
  open: boolean
  activeImage: ImageViewerItem | null
  imageCount: number
  positionLabel: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  previous: []
  next: []
}>()

const imageFailed = ref(false)
const imageLoaded = ref(false)

watch(() => props.activeImage?.id, () => {
  imageFailed.value = false
  imageLoaded.value = false
})

function markImageFailed() {
  imageFailed.value = true
}

function markImageLoaded() {
  imageLoaded.value = true
}

function close() {
  emit('update:open', false)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    emit('previous')
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    emit('next')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="!inset-0 !left-0 !top-0 !z-[80] flex !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 items-center justify-center overflow-hidden !rounded-none !border-0 !bg-transparent p-[max(3.5rem,env(safe-area-inset-top))_max(4.5rem,env(safe-area-inset-right))_max(3.5rem,env(safe-area-inset-bottom))_max(4.5rem,env(safe-area-inset-left))] !shadow-none !transition-none data-[state=closed]:!animate-none data-[state=open]:!animate-none"
      @keydown="onKeydown"
      @pointer-down-outside.prevent
      @close-auto-focus.prevent
      @click.self="close"
    >
      <div class="sr-only">
        <DialogTitle>图片查看器</DialogTitle>
        <DialogDescription>{{ positionLabel || '预览图片' }}</DialogDescription>
      </div>

      <div
        v-if="imageFailed"
        class="relative flex flex-col items-center gap-3 text-sm text-muted-foreground"
        role="status"
      >
        <ImageOff :size="32" />
        <span>图片无法显示</span>
      </div>
      <div
        v-else-if="activeImage && !imageLoaded"
        class="pointer-events-none absolute text-sm text-muted-foreground"
        role="status"
      >
        图片加载中
      </div>
      <img
        v-if="activeImage && !imageFailed"
        class="relative block max-h-full max-w-full object-contain"
        :class="{ 'opacity-0': !imageLoaded }"
        :src="activeImage.src"
        :alt="activeImage.alt"
        @load="markImageLoaded"
        @error="markImageFailed"
      >

      <div
        v-if="positionLabel"
        class="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-sm bg-background/80 px-2 py-1 text-xs text-foreground"
        aria-live="polite"
      >
        {{ positionLabel }}
      </div>

      <button
        type="button"
        class="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] inline-flex size-11 items-center justify-center rounded-sm text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="关闭图片查看器"
        title="关闭"
        @click="close"
      >
        <X :size="22" />
      </button>

      <button
        v-if="imageCount > 1"
        type="button"
        class="absolute left-[max(0.5rem,env(safe-area-inset-left))] top-1/2 inline-flex h-16 w-12 -translate-y-1/2 items-center justify-center rounded-sm text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="上一张"
        title="上一张"
        @click="emit('previous')"
      >
        <ChevronLeft :size="30" />
      </button>
      <button
        v-if="imageCount > 1"
        type="button"
        class="absolute right-[max(0.5rem,env(safe-area-inset-right))] top-1/2 inline-flex h-16 w-12 -translate-y-1/2 items-center justify-center rounded-sm text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="下一张"
        title="下一张"
        @click="emit('next')"
      >
        <ChevronRight :size="30" />
      </button>
    </DialogContent>
  </Dialog>
</template>
