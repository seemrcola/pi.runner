import { computed, ref } from 'vue'

export type ImageViewerItem = {
  id: string
  src: string
  alt: string
}

export function createImageViewerState() {
  const images = ref<ImageViewerItem[]>([])
  const activeIndex = ref(0)
  const isOpen = ref(false)
  const activeImage = computed(() => isOpen.value ? images.value[activeIndex.value] ?? null : null)
  const positionLabel = computed(() => (
    activeImage.value ? `第 ${activeIndex.value + 1} 张，共 ${images.value.length} 张` : ''
  ))

  function open(nextImages: ImageViewerItem[], index: number) {
    if (nextImages.length === 0) return
    // 复制列表，避免切换会话或删除草稿时改变已经打开的预览上下文。
    images.value = [...nextImages]
    activeIndex.value = Math.min(Math.max(index, 0), nextImages.length - 1)
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    images.value = []
    activeIndex.value = 0
  }

  function previous() {
    if (!isOpen.value || images.value.length === 0) return
    activeIndex.value = (activeIndex.value - 1 + images.value.length) % images.value.length
  }

  function next() {
    if (!isOpen.value || images.value.length === 0) return
    activeIndex.value = (activeIndex.value + 1) % images.value.length
  }

  return {
    images,
    activeIndex,
    isOpen,
    activeImage,
    positionLabel,
    open,
    close,
    previous,
    next,
  }
}
