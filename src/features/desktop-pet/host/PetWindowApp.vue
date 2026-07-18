<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import DesktopPet from '../components/DesktopPet.vue'
import type { PetState } from '../core/petTypes'

const DRAG_THRESHOLD_PX = 3

const dragging = ref(false)
let activePointerId: number | null = null
let startScreenX = 0
let startScreenY = 0
let lastScreenX = 0
let lastScreenY = 0
let suppressNextClick = false
let suppressionTimer: ReturnType<typeof setTimeout> | null = null

function hidePet() {
  window.piPet?.hide()
}

function updatePetState(state: PetState) {
  window.piPet?.updateState(state)
}

function handlePointerDown(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || activePointerId !== null) return

  activePointerId = event.pointerId
  startScreenX = event.screenX
  startScreenY = event.screenY
  lastScreenX = event.screenX
  lastScreenY = event.screenY
  window.piPet?.beginDrag()

  // capture 保留在原始表面，短点击生成的 click 仍会派发给原按钮；
  // pointermove/up 会继续冒泡到窗口根节点，拖出 160px 边界也不会丢事件。
  const captureTarget = event.target
  if (captureTarget instanceof Element) captureTarget.setPointerCapture?.(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerId !== activePointerId) return

  if (!dragging.value) {
    const distance = Math.hypot(event.screenX - startScreenX, event.screenY - startScreenY)
    if (distance < DRAG_THRESHOLD_PX) return
    dragging.value = true
  }

  const deltaX = event.screenX - lastScreenX
  const deltaY = event.screenY - lastScreenY
  lastScreenX = event.screenX
  lastScreenY = event.screenY
  window.piPet?.dragBy(deltaX, deltaY)
}

function finishPointerInteraction(event: PointerEvent) {
  if (event.pointerId !== activePointerId) return

  activePointerId = null
  if (dragging.value) {
    // 浏览器会在 pointerup 后合成 click；拖拽完成时必须拦掉它，避免误触说话或隐藏。
    suppressNextClick = true
    if (suppressionTimer !== null) clearTimeout(suppressionTimer)
    suppressionTimer = setTimeout(() => {
      suppressNextClick = false
      suppressionTimer = null
    }, 0)
  }
  dragging.value = false
}

function handleClickCapture(event: MouseEvent) {
  if (!suppressNextClick) return

  suppressNextClick = false
  if (suppressionTimer !== null) {
    clearTimeout(suppressionTimer)
    suppressionTimer = null
  }
  event.preventDefault()
  event.stopImmediatePropagation()
}

onBeforeUnmount(() => {
  if (suppressionTimer !== null) clearTimeout(suppressionTimer)
})
</script>

<template>
  <main
    class="pet-window-shell"
    :class="{ 'pet-window-shell--dragging': dragging }"
    @click.capture="handleClickCapture"
    @lostpointercapture="finishPointerInteraction"
    @pointercancel="finishPointerInteraction"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="finishPointerInteraction"
  >
    <DesktopPet @request-close="hidePet" @state-change="updatePetState" />
  </main>
</template>

<style scoped>
:global(html[data-window='pet']),
:global(html[data-window='pet'] body),
:global(html[data-window='pet'] #app) {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.pet-window-shell {
  width: 160px;
  height: 160px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.pet-window-shell--dragging,
.pet-window-shell--dragging :deep(*) {
  cursor: grabbing !important;
}
</style>
