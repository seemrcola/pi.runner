import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createImageViewerState,
  type ImageViewerItem,
} from '../../src/lib/imageViewerState'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const images: ImageViewerItem[] = [
  { id: 'first', src: 'data:image/png;base64,abc', alt: '用户附加图片 1' },
  { id: 'second', src: 'data:image/jpeg;base64,def', alt: '用户附加图片 2' },
]

describe('image viewer state', () => {
  it('opens the requested image and exposes its position', () => {
    const viewer = createImageViewerState()

    viewer.open(images, 1)

    expect(viewer.isOpen.value).toBe(true)
    expect(viewer.activeIndex.value).toBe(1)
    expect(viewer.activeImage.value).toEqual(images[1])
    expect(viewer.positionLabel.value).toBe('第 2 张，共 2 张')
  })

  it('wraps navigation and closes cleanly', () => {
    const viewer = createImageViewerState()
    viewer.open(images, 0)

    viewer.previous()
    expect(viewer.activeImage.value).toEqual(images[1])
    viewer.next()
    expect(viewer.activeImage.value).toEqual(images[0])
    viewer.close()
    expect(viewer.isOpen.value).toBe(false)
    expect(viewer.activeImage.value).toBeNull()
  })

  it('copies the image list so later message mutations cannot change an open viewer', () => {
    const viewer = createImageViewerState()
    const mutableImages = [...images]
    viewer.open(mutableImages, 0)

    mutableImages.splice(0, mutableImages.length, {
      id: 'other-conversation',
      src: 'data:image/png;base64,xyz',
      alt: '另一会话图片',
    })

    expect(viewer.activeImage.value).toEqual(images[0])
  })
})

describe('image viewer architecture', () => {
  it('mounts one application-level viewer and closes it before global commands', () => {
    const app = readSource('../../src/App.vue')

    expect(app).toContain('<ImageViewerOverlay')
    expect(app).toContain('imageViewer.close()')
    expect(app).toContain('@open-image-viewer="openImageViewer"')
    expect(app).toContain('restoreImageTriggerFocus')
  })

  it('keeps thumbnail lists free of global listeners and modal ownership', () => {
    const thumbnails = readSource('../../src/components/image-viewer/ImageThumbnailList.vue')

    expect(thumbnails).not.toContain('window.addEventListener')
    expect(thumbnails).not.toContain('Teleport')
    expect(thumbnails).toContain("emit('open'")
  })

})
