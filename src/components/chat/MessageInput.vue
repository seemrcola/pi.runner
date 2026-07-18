<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowUp, CornerDownRight, Square, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PendingSteer } from '@/lib/conversationRuntime'
import { ImageThumbnailList } from '../image-viewer'
import { toImageViewerItems } from '@/lib/chatImageViewer'
import type { ImageViewerItem } from '@/lib/imageViewerState'
import {
  MAX_PROMPT_IMAGE_BASE64_CHARS,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGES,
  type ImageContent,
  isImageContentMimeType,
} from '@shared/chat'

const props = defineProps<{
  modelValue: string
  images: ImageContent[]
  isConnected: boolean
  isStarting: boolean
  isRunning: boolean
  pendingSteers: PendingSteer[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:images': [value: ImageContent[]]
  send: []
  stop: []
  'submit-steer': [id: string]
  'remove-steer': [id: string]
  'open-image-viewer': [images: ImageViewerItem[], index: number, trigger: HTMLButtonElement]
}>()

const inputRef = ref<InstanceType<typeof Textarea> | null>(null)
const imageErrors = ref<string[]>([])

watch(
  () => props.images.length,
  (length, previousLength) => {
    if (length === 0 && previousLength > 0) imageErrors.value = []
  },
)

const canSend = computed(
  () =>
    (props.modelValue.trim().length > 0 || props.images.length > 0) &&
    props.isConnected &&
    !props.isStarting,
)
const showStopAction = computed(() => props.isRunning && !canSend.value)
const draftImageItems = computed(() => toImageViewerItems(props.images, '附加图片'))

function onInputKeydown(event: KeyboardEvent) {
  // 输入法组合态（如中文输入法选词时按回车）不触发发送
  if (event.isComposing) return

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (canSend.value) emit('send')
  }
}

function onModelUpdate(value: string | number) {
  emit('update:modelValue', String(value))
}

async function handlePaste(event: ClipboardEvent) {
  const images = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  if (images.length === 0) return

  event.preventDefault()
  await appendImageFiles(images)
}

async function handleDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (!files.some((file) => file.type.startsWith('image/'))) return

  event.preventDefault()
  await appendImageFiles(files.filter((file) => file.type.startsWith('image/')))
}

function handleDragOver(event: DragEvent) {
  if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/'))) {
    event.preventDefault()
  }
}

async function appendImageFiles(files: File[]) {
  const next = [...props.images]
  const errors: string[] = []
  for (const file of files) {
    if (next.length >= MAX_PROMPT_IMAGES) {
      errors.push('最多附加 6 张图片')
      continue
    }
    try {
      const image = await processImageFile(file)
      if (image) {
        if (image.data.length > MAX_PROMPT_IMAGE_BASE64_CHARS) {
          errors.push('图片处理后超过 10MB，无法发送')
        } else {
          next.push(image)
        }
      } else {
        errors.push(rejectReasonForImageFile(file))
      }
    } catch {
      errors.push('无法读取图片')
    }
  }
  imageErrors.value = [...new Set(errors)]
  emit('update:images', next)
}

async function processImageFile(file: File): Promise<ImageContent | null> {
  if (rejectReasonForImageFile(file)) return null
  if (file.type === 'image/gif') return fileToImageContent(file)
  return resizeImageFile(file, 2000, 0.86).catch(() => fileToImageContent(file))
}

function rejectReasonForImageFile(file: File): string {
  if (file.size > MAX_PROMPT_IMAGE_BYTES) return '图片超过 10MB，无法发送'
  if (!isImageContentMimeType(file.type)) {
    return '仅支持 PNG、JPEG、WebP 或 GIF 图片'
  }
  return ''
}

function fileToImageContent(file: File): Promise<ImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(dataUrlToImageContent(String(reader.result), file.type))
    reader.readAsDataURL(file)
  })
}

function resizeImageFile(file: File, maxEdge: number, quality: number): Promise<ImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const image = new Image()
      image.onerror = reject
      image.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')?.drawImage(image, 0, 0, width, height)
        // 保留 PNG 透明度；其余静态图片转 JPEG 以降低 RPC payload 和模型输入成本。
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        resolve(dataUrlToImageContent(canvas.toDataURL(outputType, quality), outputType))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function dataUrlToImageContent(dataUrl: string, fallbackMimeType: string): ImageContent {
  const [meta, data = ''] = dataUrl.split(',')
  const parsedMimeType = meta.match(/^data:(.*?);base64$/)?.[1] || fallbackMimeType
  const mimeType = isImageContentMimeType(parsedMimeType) ? parsedMimeType : 'image/png'
  return { type: 'image', data, mimeType }
}

function removeImage(index: number) {
  const next = props.images.filter((_, itemIndex) => itemIndex !== index)
  if (next.length === 0) imageErrors.value = []
  emit('update:images', next)
}

function openImageViewer(items: ImageViewerItem[], index: number, trigger: HTMLButtonElement) {
  emit('open-image-viewer', items, index, trigger)
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="min-w-0 px-10 pb-4">
    <div class="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div
        v-if="pendingSteers.length > 0"
        class="divide-y divide-border border-b border-border bg-background/60"
      >
        <div
          v-for="pending in pendingSteers"
          :key="pending.id"
          class="flex h-8 items-center gap-3 px-4"
        >
          <div class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {{ pending.text || '[图片]' }}
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xs hover:text-foreground"
            :disabled="!isConnected || isStarting"
            title="追加指令"
            @click="emit('submit-steer', pending.id)"
          >
            <CornerDownRight :size="12" />
            追加指令
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7 text-muted-foreground hover:text-destructive"
            title="移除追加指令"
            @click="emit('remove-steer', pending.id)"
          >
            <Trash2 :size="12" />
          </Button>
        </div>
      </div>
      <div class="relative min-w-0">
        <div
          v-if="images.length > 0 || imageErrors.length > 0"
          class="border-b border-border bg-background/60 px-3 py-2"
        >
          <ImageThumbnailList
            v-if="images.length > 0"
            :images="draftImageItems"
            aria-label="待发送图片列表"
            compact
            @open="openImageViewer"
          >
            <template #thumbnail-overlay="{ index }">
              <Button
                variant="destructive"
                size="icon-sm"
                class="absolute right-1 top-1 size-5 rounded-sm p-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                :aria-label="`移除图片 ${index + 1}`"
                :title="`移除图片 ${index + 1}`"
                @click.stop="removeImage(index)"
              >
                <Trash2 :size="11" />
              </Button>
            </template>
          </ImageThumbnailList>
          <div v-if="imageErrors.length > 0" class="mt-1 space-y-0.5 text-xs text-destructive">
            <div v-for="error in imageErrors" :key="error">
              {{ error }}
            </div>
          </div>
        </div>
        <div class="relative min-w-0">
          <Textarea
            ref="inputRef"
            :model-value="modelValue"
            spellcheck="false"
            rows="3"
            placeholder="给 Pi 发送任务"
            :disabled="isStarting"
            class="max-h-[200px] min-h-[96px] resize-none border-0 bg-card py-3 pl-4 pr-14 text-sm shadow-none placeholder:text-muted-foreground/50 focus-visible:border-0 focus-visible:ring-0"
            @update:model-value="onModelUpdate"
            @keydown="onInputKeydown"
            @paste="handlePaste"
            @drop="handleDrop"
            @dragover="handleDragOver"
          />
          <Button
            v-if="showStopAction"
            variant="destructive"
            size="icon-sm"
            class="absolute right-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
            title="停止"
            @click="emit('stop')"
          >
            <Square :size="14" />
          </Button>
          <Button
            v-if="canSend"
            size="sm"
            class="absolute right-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm bg-primary p-0 text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-30"
            :disabled="!canSend"
            :title="isRunning ? '追加指令' : '发送'"
            @click="emit('send')"
          >
            <ArrowUp :size="18" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
