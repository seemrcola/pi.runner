import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

// 单例 Marked 实例：集成 highlight.js 代码高亮
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      try {
        return hljs.highlight(code, { language }).value
      } catch {
        return code
      }
    },
  }),
)

marked.setOptions({
  breaks: true, // 单换行转为 <br>
  gfm: true, // GitHub Flavored Markdown（表格、删除线等）
})

/**
 * 将 Markdown 文本渲染为经过净化的 HTML 字符串。
 * 支持 GFM、代码高亮（highlight.js）与 XSS 净化（DOMPurify）。
 */
export function renderMarkdown(content: string): string {
  if (!content) return ''
  const rawHtml = marked.parse(content, { async: false }) as string
  const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target'],
  })
  return restrictLinkProtocols(sanitizedHtml)
}

function restrictLinkProtocols(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html

  // Electron 只会把绝对 HTTP(S) 地址交给系统浏览器；这里先移除可执行协议，避免其绕过导航事件。
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    try {
      const url = new URL(href)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        anchor.setAttribute('href', url.toString())
        continue
      }
    } catch {
      // 相对地址在本地 renderer 中没有可靠目标，也不应回退成 file: 导航。
    }
    anchor.removeAttribute('href')
  }

  return template.innerHTML
}
