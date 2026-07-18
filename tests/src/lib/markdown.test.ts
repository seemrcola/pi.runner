// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../../src/lib/markdown'

describe('Markdown links', () => {
  it('keeps http and https links clickable for Electron to open externally', () => {
    const html = renderMarkdown('[文档](https://example.com/docs?q=1) [本地服务](http://127.0.0.1:3000/)')

    expect(html).toContain('href="https://example.com/docs?q=1"')
    expect(html).toContain('href="http://127.0.0.1:3000/"')
  })

  it('removes executable link protocols before inserting HTML', () => {
    const html = renderMarkdown('[危险链接](javascript:alert(1)) <a href="file:///Users/example/secret">本地文件</a>')

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('file:')
    expect(html).not.toContain('href=')
  })
})
