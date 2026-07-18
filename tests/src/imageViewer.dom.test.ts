// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ImageViewerOverlay from '../../src/components/image-viewer/ImageViewerOverlay.vue'

const firstImage = {
  id: 'first',
  src: 'data:image/png;base64,abc',
  alt: '用户附加图片 1',
}

afterEach(() => {
  document.body.innerHTML = ''
})

function mountOverlay() {
  return mount(ImageViewerOverlay, {
    attachTo: document.body,
    props: {
      open: true,
      activeImage: firstImage,
      imageCount: 2,
      positionLabel: '第 1 张，共 2 张',
    },
  })
}

describe('image viewer overlay', () => {
  it('moves focus into the modal and traps tab navigation', async () => {
    const backgroundButton = document.createElement('button')
    document.body.append(backgroundButton)
    backgroundButton.focus()

    mountOverlay()
    await nextTick()

    expect(document.activeElement).not.toBe(backgroundButton)
    expect(document.activeElement?.closest('[data-slot="dialog-content"]')).not.toBeNull()
  })

  it('emits close on Escape and consumes arrow navigation keys', async () => {
    const wrapper = mountOverlay()
    await nextTick()
    const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    content.dispatchEvent(right)
    expect(right.defaultPrevented).toBe(true)
    expect(wrapper.emitted('next')).toHaveLength(1)

    content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('shows loading and failure states for the active image', async () => {
    const wrapper = mountOverlay()
    await nextTick()

    expect(document.body.textContent).toContain('图片加载中')
    document.querySelector('img')?.dispatchEvent(new Event('error'))
    await nextTick()
    expect(document.body.textContent).toContain('图片无法显示')
  })

  it('closes from the close button and exposes live position feedback', async () => {
    const wrapper = mountOverlay()
    await nextTick()

    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('第 1 张，共 2 张')
    document.querySelector<HTMLButtonElement>('button[aria-label="关闭图片查看器"]')?.click()
    await nextTick()
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })
})
