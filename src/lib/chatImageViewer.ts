import type { ImageContent } from '@shared/chat'
import type { ImageViewerItem } from './imageViewerState'

export function toImageViewerItems(images: ImageContent[], altPrefix: string): ImageViewerItem[] {
  return images.map((image, index) => ({
    // 图片内容参与身份，删除或重排同 MIME 图片时不会错误复用缩略图 DOM。
    id: `${image.mimeType}-${image.data.slice(0, 32)}-${index}`,
    src: `data:${image.mimeType};base64,${image.data}`,
    alt: `${altPrefix} ${index + 1}`,
  }))
}
