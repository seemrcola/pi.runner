<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '@/lib/markdown'
import { useCopy } from '@/composables/useCopy'

const props = defineProps<{ content: string }>()

const rootRef = ref<HTMLElement | null>(null)

// lucide 图标 SVG（copy / check）
const ICON_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const ICON_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

// 把复制按钮作为 HTML 字符串注入每个 <pre>，随 v-html 一起渲染。
// 这样按钮始终存在于 DOM，不存在「先无后有」的延迟挂载，重渲染时也不会闪烁。
function withCopyButtons(html: string): string {
  if (!html) return ''
  return html.replace(
    /<pre(\s[^>]*)?>/g,
    `<pre$1><button type="button" class="md-copy-btn" title="Copy">${ICON_COPY}</button>`,
  )
}

const html = computed(() => withCopyButtons(renderMarkdown(props.content)))

// 复制逻辑由 useCopy 统一封装（剪贴板写入 + 回退 + copied 反馈 + 定时复位）。
// 按钮在 v-html 中是命令式 DOM，无法用响应式 class 绑定，故这里用 watch(copied)
// 单定时器驱动图标复位，onClick 负责乐观切换 + 失败回滚。
const { copied, copy } = useCopy()
let activeBtn: HTMLElement | null = null

watch(copied, (now) => {
  // 仅在反馈结束时复位当前按钮图标（激活态由 onClick 乐观设置）
  if (now || !activeBtn) return
  activeBtn.innerHTML = ICON_COPY
  activeBtn = null
})

// 事件委托：根容器单个监听器，点击 .md-copy-btn 时复制对应 pre>code 文本。
// 根容器本身持久存在（v-html 只换 innerHTML），监听器无需重新绑定。
function onClick(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest('.md-copy-btn') as HTMLElement | null
  if (!target) return
  const pre = target.parentElement
  if (!pre) return
  const code = pre.querySelector('code')
  const text = code?.textContent ?? ''
  // 切换到新按钮前，先把上一个仍处于反馈态的按钮复位
  if (activeBtn && activeBtn !== target) {
    activeBtn.innerHTML = ICON_COPY
  }
  activeBtn = target
  target.innerHTML = ICON_CHECK
  void copy(text).then((ok) => {
    if (!ok && activeBtn === target) {
      target.innerHTML = ICON_COPY
      activeBtn = null
    }
  })
}

onMounted(() => rootRef.value?.addEventListener('click', onClick))
onBeforeUnmount(() => rootRef.value?.removeEventListener('click', onClick))
</script>

<template>
  <div ref="rootRef" class="markdown-body" v-html="html" />
</template>
