<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { createPetDirector } from '../core/petDirector'
import type { PetDialogue, PetDirectorSnapshot, PetState } from '../core/petTypes'
import PixelPetOrb from './PixelPetOrb.vue'

const props = withDefaults(defineProps<{
  autoStart?: boolean
  dialogue?: Partial<PetDialogue>
  initialState?: PetState
}>(), {
  autoStart: true,
  initialState: 'resting',
})

const emit = defineEmits<{
  'request-close': []
  speak: [line: string]
  'state-change': [state: PetState]
}>()

const director = createPetDirector({
  dialogue: props.dialogue,
  initialState: props.initialState,
})
const snapshot = ref<PetDirectorSnapshot>(director.getSnapshot())
let unsubscribe: (() => void) | null = null
let previousStateRevision = snapshot.value.stateRevision
let previousSpeechRevision = snapshot.value.speechRevision

onMounted(() => {
  unsubscribe = director.subscribe((nextSnapshot) => {
    snapshot.value = nextSnapshot
    if (nextSnapshot.stateRevision !== previousStateRevision) {
      previousStateRevision = nextSnapshot.stateRevision
      emit('state-change', nextSnapshot.state)
    }
    if (nextSnapshot.speechRevision !== previousSpeechRevision) {
      previousSpeechRevision = nextSnapshot.speechRevision
      emit('speak', nextSnapshot.line)
    }
  })
  emit('state-change', snapshot.value.state)
  if (props.autoStart) director.start()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  director.stop()
})
</script>

<template>
  <section class="desktop-pet" aria-label="Pi 桌面宠物">
    <div class="desktop-pet__bubble" :class="{ 'desktop-pet__bubble--visible': snapshot.lineVisible }">
      <p aria-live="polite" role="status">{{ snapshot.line }}</p>
    </div>

    <button
      type="button"
      class="desktop-pet__close"
      aria-label="隐藏桌面宠物"
      title="隐藏桌面宠物"
      @click.stop="emit('request-close')"
    >
      <X :size="14" />
    </button>

    <button
      type="button"
      class="desktop-pet__character"
      aria-label="让像素球宠物说句话"
      title="让像素球宠物说句话"
      @click="director.speak()"
    >
      <PixelPetOrb :state="snapshot.state" />
    </button>
  </section>
</template>

<style scoped>
.desktop-pet {
  position: relative;
  width: 160px;
  height: 160px;
  overflow: hidden;
  color: #202226;
  user-select: none;
}

.desktop-pet__bubble {
  position: absolute;
  z-index: 2;
  top: 5px;
  left: 5px;
  width: 150px;
  min-height: 40px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7px 9px;
  border: 2px solid #27282c;
  border-radius: 5px;
  background: #f7f4ed;
  box-shadow: 3px 3px 0 rgb(0 0 0 / 28%);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.desktop-pet__bubble::after {
  position: absolute;
  right: 28px;
  bottom: -8px;
  width: 11px;
  height: 11px;
  border-right: 2px solid #27282c;
  border-bottom: 2px solid #27282c;
  background: #f7f4ed;
  content: '';
  transform: rotate(45deg);
}

.desktop-pet__bubble--visible {
  opacity: 1;
  transform: translateY(0);
}

.desktop-pet__bubble p {
  width: 100%;
  max-height: 30.5px;
  margin: 0;
  display: -webkit-box;
  overflow-wrap: anywhere;
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1.45;
  letter-spacing: 0;
  text-align: center;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.desktop-pet__close {
  position: absolute;
  z-index: 4;
  right: 6px;
  bottom: 6px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: #27282c;
  color: #f7f4ed;
  box-shadow: 3px 3px 0 rgb(0 0 0 / 28%);
  cursor: pointer;
}

.desktop-pet__close:hover,
.desktop-pet__close:focus-visible {
  background: #3b3d43;
  color: #ffffff;
  outline: 2px solid #d19c3c;
  outline-offset: 1px;
}

.desktop-pet__character {
  position: absolute;
  left: 34px;
  bottom: 4px;
  width: 92px;
  height: 98px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.desktop-pet__character:focus-visible {
  outline: 3px solid #50c6b2;
  outline-offset: -5px;
}

@media (prefers-reduced-motion: reduce) {
  .desktop-pet__bubble {
    transition: none;
  }
}
</style>
