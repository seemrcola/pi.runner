import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface UseCopyOptions {
  /** 「已复制」反馈持续时长（ms），默认 1500 */
  duration?: number
}

export interface UseCopyReturn {
  /** 是否处于「已复制」反馈态，配合定时器自动复位 */
  copied: Ref<boolean>
  /** 复制文本；成功返回 true。优先 navigator.clipboard，失败回退 execCommand */
  copy: (text: string) => Promise<boolean>
}

/** 写入剪贴板：现代 API 优先，不可用或失败时回退到 textarea + execCommand。 */
async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 非安全上下文或权限被拒，走回退
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * 复制到剪贴板的通用 hook。
 *
 * @example
 * const { copied, copy } = useCopy()
 * <button @click="copy('hello')">{{ copied ? 'Copied!' : 'Copy' }}</button>
 */
export function useCopy(options: UseCopyOptions = {}): UseCopyReturn {
  const duration = options.duration ?? 1500
  const copied = ref(false)
  let timer: number | null = null

  async function copy(text: string): Promise<boolean> {
    const ok = await writeClipboard(text)
    if (!ok) return false
    copied.value = true
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      copied.value = false
      timer = null
    }, duration)
    return true
  }

  onBeforeUnmount(() => {
    if (timer != null) window.clearTimeout(timer)
  })

  return { copied, copy }
}
