<script setup lang="ts">
import type { ImageViewerItem } from '@/lib/imageViewerState'

withDefaults(defineProps<{
  images: ImageViewerItem[]
  ariaLabel?: string
  compact?: boolean
}>(), {
  ariaLabel: '图片列表',
  compact: false,
})

const emit = defineEmits<{
  open: [images: ImageViewerItem[], index: number, trigger: HTMLButtonElement]
}>()

function open(images: ImageViewerItem[], index: number, event: MouseEvent) {
  emit('open', images, index, event.currentTarget as HTMLButtonElement)
}
</script>

<template>
  <div
    class="image-thumbnail-list"
    :class="{ 'image-thumbnail-list--compact': compact }"
    role="list"
    :aria-label="ariaLabel"
  >
    <div v-for="(image, index) in images" :key="image.id" class="group image-thumbnail-list__item" role="listitem">
      <button
        type="button"
        class="image-thumbnail-list__button"
        :aria-label="`打开${image.alt}`"
        @click="open(images, index, $event)"
      >
        <img :src="image.src" :alt="image.alt">
      </button>
      <slot name="thumbnail-overlay" :image="image" :index="index" />
    </div>
  </div>
</template>

<style scoped>
.image-thumbnail-list {
  display: flex;
  max-width: 100%;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.image-thumbnail-list__item,
.image-thumbnail-list__button,
.image-thumbnail-list__button img {
  max-inline-size: min(256px, 100%);
  max-block-size: 192px;
}

.image-thumbnail-list__item {
  position: relative;
  display: flex;
  min-width: 0;
}

.image-thumbnail-list__button {
  display: flex;
  padding: 0;
  cursor: zoom-in;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--muted));
}

.image-thumbnail-list__button img {
  display: block;
  width: auto;
  height: auto;
  object-fit: contain;
}

.image-thumbnail-list--compact {
  justify-content: flex-start;
}

.image-thumbnail-list--compact .image-thumbnail-list__item,
.image-thumbnail-list--compact .image-thumbnail-list__button,
.image-thumbnail-list--compact .image-thumbnail-list__button img {
  width: 56px;
  height: 56px;
}

.image-thumbnail-list--compact .image-thumbnail-list__button img {
  object-fit: cover;
}

.image-thumbnail-list__button:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}
</style>
