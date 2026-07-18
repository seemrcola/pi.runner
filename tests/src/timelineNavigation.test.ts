// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import TimelineNavigator from '../../src/components/chat/TimelineNavigator.vue'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('timeline navigation', () => {
  test('App renders a native timeline navigator as an overlay over the message list', () => {
    const app = readSource('../../src/App.vue')

    expect(app).toContain("import TimelineNavigator from '@/components/chat/TimelineNavigator.vue'")
    expect(app).toContain('<TimelineNavigator')
    expect(app).toContain(':messages="activeMessages"')
    expect(app).toContain('@select="scrollToMessage"')
    expect(app).toContain('relative flex min-h-0 min-w-0 flex-1')
    expect(app).toContain('grid h-screen grid-cols-[260px_minmax(0,1fr)] gap-0')
    expect(app).not.toContain('showTimeline')
    expect(app).not.toContain('TimelinePanel')
  })

  test('MessageList exposes message anchors for timeline positioning', () => {
    const messageList = readSource('../../src/components/message/MessageList.vue')

    expect(messageList).toContain('function scrollToMessage(messageId: string)')
    expect(messageList).toContain('data-message-id')
    expect(messageList).toContain('highlightedMessageId')
    expect(messageList).toContain('defineExpose({ scrollToBottom, forceScrollToBottom, scrollToMessage })')
  })

  test('TimelineNavigator summarizes turns and emits selected message ids', async () => {
    const wrapper = mount(TimelineNavigator, {
      props: {
        messages: [
          { id: 'user-1', role: 'user', text: '检查测试', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            text: '测试通过',
            timestamp: 2,
            tools: [{ toolName: 'bash', toolCallId: 'tool-1', status: 'done' }],
          },
        ],
        turns: [{ id: 'user-1', messageIds: ['user-1', 'assistant-1'] }],
      },
    })

    await wrapper.get('li').trigger('mouseenter')
    expect(wrapper.text()).toContain('检查测试')
    expect(wrapper.text()).toContain('测试通过')
    expect(wrapper.text()).toContain('1 次工具调用')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['user-1']])
  })

  test('TimelineNavigator floats at the left center with horizontal markers', () => {
    const navigator = readSource('../../src/components/chat/TimelineNavigator.vue')

    expect(navigator).toContain('absolute left-0 top-1/2')
    expect(navigator).toContain('max-h-[min(420px,60vh)]')
    expect(navigator).toContain('<ScrollArea')
    expect(navigator).toContain('h-2 w-6')
    expect(navigator).toContain('justify-start')
    expect(navigator).toContain('markerStyle(index, turn)')
    expect(navigator).toContain('hoveredTurnIndex')
    expect(navigator).toContain('Math.exp')
    expect(navigator).toContain('height: `${baseHeight}px`')
    expect(navigator).toContain('width: `${baseWidth + 14 * weight}px`')
    expect(navigator).toContain('gap-0')
  })
})
