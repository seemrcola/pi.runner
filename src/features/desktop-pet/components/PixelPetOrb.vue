<script setup lang="ts">
import type { PetState } from '../core/petTypes'

const props = defineProps<{
  state: PetState
}>()

function stateLabel() {
  if (props.state === 'coding') return '正在敲代码的滑稽像素球宠物'
  if (props.state === 'resting') return '正在休息的滑稽像素球宠物'
  if (props.state === 'thinking') return '正在思考的滑稽像素球宠物'
  return '正在散步的滑稽像素球宠物'
}
</script>

<template>
  <div :class="['pixel-pet-orb', `pixel-pet-orb--${state}`]" role="img" :aria-label="stateLabel()">
    <span class="pixel-pet-orb__ear pixel-pet-orb__ear--left" aria-hidden="true" />
    <span class="pixel-pet-orb__ear pixel-pet-orb__ear--right" aria-hidden="true" />
    <div class="pixel-pet-orb__shell" />
    <div class="pixel-pet-orb__face">
      <span class="pixel-pet-orb__eye pixel-pet-orb__eye--left" />
      <span class="pixel-pet-orb__eye pixel-pet-orb__eye--right" />
      <span class="pixel-pet-orb__cheek pixel-pet-orb__cheek--left" aria-hidden="true" />
      <span class="pixel-pet-orb__cheek pixel-pet-orb__cheek--right" aria-hidden="true" />
      <span class="pixel-pet-orb__mouth" />
    </div>
    <span class="pixel-pet-orb__signal" aria-hidden="true" />
  </div>
</template>

<style scoped>
.pixel-pet-orb {
  position: relative;
  width: 78px;
  height: 78px;
  flex: 0 0 78px;
  filter: drop-shadow(4px 5px 0 rgb(0 0 0 / 24%));
}

.pixel-pet-orb__ear {
  position: absolute;
  z-index: 0;
  top: 4px;
  width: 18px;
  height: 18px;
  background: #302b33;
  clip-path: polygon(0 0, 100% 35%, 65% 100%, 18% 78%);
}

.pixel-pet-orb__ear::after {
  position: absolute;
  inset: 5px;
  background: #f08a98;
  content: '';
  clip-path: inherit;
}

.pixel-pet-orb__ear--left {
  left: 7px;
  transform: rotate(-15deg);
}

.pixel-pet-orb__ear--right {
  right: 7px;
  transform: scaleX(-1) rotate(-15deg);
}

.pixel-pet-orb__shell {
  position: absolute;
  z-index: 1;
  inset: 7px 3px 1px;
  background: #302b33;
  clip-path: polygon(28% 0, 72% 0, 88% 8%, 100% 28%, 100% 70%, 88% 92%, 70% 100%, 30% 100%, 12% 92%, 0 70%, 0 30%, 12% 8%);
}

.pixel-pet-orb__shell::before {
  position: absolute;
  inset: 5px;
  background: #c8d968;
  clip-path: inherit;
  content: '';
}

.pixel-pet-orb__shell::after {
  position: absolute;
  top: 7px;
  left: 18px;
  width: 25px;
  height: 6px;
  background: #edf1aa;
  content: '';
  transform: rotate(-5deg);
}

.pixel-pet-orb__face {
  position: absolute;
  z-index: 2;
  inset: 0;
}

.pixel-pet-orb__eye {
  position: absolute;
  background: #fffaf0;
  box-shadow: 0 0 0 4px #302b33;
  transform-origin: 50% 50%;
}

.pixel-pet-orb__eye::before {
  position: absolute;
  width: 7px;
  height: 8px;
  background: #211e24;
  content: '';
}

.pixel-pet-orb__eye::after {
  position: absolute;
  width: 3px;
  height: 3px;
  background: #ffffff;
  content: '';
}

.pixel-pet-orb__eye--left {
  top: 27px;
  left: 17px;
  width: 18px;
  height: 21px;
}

.pixel-pet-orb__eye--left::before {
  right: 2px;
  bottom: 3px;
}

.pixel-pet-orb__eye--left::after {
  right: 3px;
  bottom: 8px;
}

.pixel-pet-orb__eye--right {
  top: 31px;
  right: 16px;
  width: 14px;
  height: 16px;
}

.pixel-pet-orb__eye--right::before {
  bottom: 2px;
  left: 1px;
}

.pixel-pet-orb__eye--right::after {
  bottom: 7px;
  left: 2px;
}

.pixel-pet-orb__cheek {
  position: absolute;
  top: 52px;
  width: 8px;
  height: 5px;
  background: #ef8494;
}

.pixel-pet-orb__cheek--left { left: 13px; }
.pixel-pet-orb__cheek--right { right: 12px; }

.pixel-pet-orb__mouth {
  position: absolute;
  top: 53px;
  left: 31px;
  width: 18px;
  height: 11px;
  background: #302b33;
  clip-path: polygon(0 0, 100% 18%, 78% 100%, 25% 82%);
}

.pixel-pet-orb__mouth::after {
  position: absolute;
  right: 3px;
  bottom: 1px;
  width: 8px;
  height: 4px;
  background: #f08a98;
  content: '';
}

.pixel-pet-orb__signal {
  position: absolute;
  z-index: 3;
  top: 9px;
  right: -1px;
  width: 6px;
  height: 6px;
  background: #54c9d2;
  box-shadow: 0 9px 0 #54c9d2;
}

.pixel-pet-orb--resting .pixel-pet-orb__eye {
  top: 36px;
  height: 4px;
  background: #302b33;
  box-shadow: none;
}

.pixel-pet-orb--resting .pixel-pet-orb__eye::before,
.pixel-pet-orb--resting .pixel-pet-orb__eye::after,
.pixel-pet-orb--resting .pixel-pet-orb__mouth::after {
  display: none;
}

.pixel-pet-orb--resting .pixel-pet-orb__eye--left {
  left: 18px;
  width: 17px;
  transform: rotate(7deg);
}

.pixel-pet-orb--resting .pixel-pet-orb__eye--right {
  right: 17px;
  width: 14px;
  transform: rotate(-7deg);
}

.pixel-pet-orb--resting .pixel-pet-orb__mouth {
  top: 52px;
  left: 30px;
  width: 20px;
  height: 8px;
  background: transparent;
  border-right: 4px solid #302b33;
  border-bottom: 4px solid #302b33;
  border-left: 4px solid #302b33;
  clip-path: none;
}

.pixel-pet-orb--resting .pixel-pet-orb__signal {
  top: 8px;
  right: -1px;
  width: 9px;
  height: 3px;
  background: #d7e1e8;
  box-shadow: 4px 5px 0 #d7e1e8, 0 10px 0 #d7e1e8;
}

.pixel-pet-orb--thinking .pixel-pet-orb__eye--left::before {
  right: 7px;
  bottom: 8px;
}

.pixel-pet-orb--thinking .pixel-pet-orb__eye--right {
  top: 35px;
  height: 12px;
  transform: rotate(8deg);
}

.pixel-pet-orb--thinking .pixel-pet-orb__mouth {
  top: 54px;
  left: 35px;
  width: 10px;
  height: 10px;
  background: #fffaf0;
  border: 4px solid #302b33;
  clip-path: none;
}

.pixel-pet-orb--thinking .pixel-pet-orb__mouth::after {
  display: none;
}

.pixel-pet-orb--thinking .pixel-pet-orb__signal {
  width: 7px;
  height: 7px;
  background: #e4ad45;
  box-shadow: 7px -5px 0 #e4ad45, 7px 6px 0 #e4ad45;
}

.pixel-pet-orb--walking .pixel-pet-orb__shell {
  animation: orb-roll 620ms steps(8, end) infinite;
}

.pixel-pet-orb--walking .pixel-pet-orb__eye--left {
  top: 25px;
  height: 23px;
}

.pixel-pet-orb--walking .pixel-pet-orb__mouth {
  top: 51px;
  left: 30px;
  width: 22px;
  height: 14px;
  clip-path: polygon(0 0, 100% 0, 82% 100%, 20% 100%);
}

.pixel-pet-orb--walking .pixel-pet-orb__mouth::after {
  right: 3px;
  bottom: -2px;
  width: 11px;
  height: 8px;
}

.pixel-pet-orb--walking .pixel-pet-orb__signal {
  top: 15px;
  right: -2px;
  width: 10px;
  height: 4px;
  background: #72c9e9;
  box-shadow: 6px 7px 0 #72c9e9;
}

@keyframes orb-roll {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .pixel-pet-orb__shell {
    animation: none;
  }
}
</style>
