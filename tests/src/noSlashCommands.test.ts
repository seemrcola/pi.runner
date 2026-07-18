// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import MessageInput from '../../src/components/chat/MessageInput.vue'

describe('slash command integration removal', () => {
  test('renderer submits slash-looking input as normal prompt text', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        modelValue: '/review the current project',
        images: [],
        isConnected: true,
        isStarting: false,
        isRunning: false,
        pendingSteers: [],
      },
    })

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('命令菜单')
  })

  test('shows stop only when a running conversation has no sendable draft', async () => {
    const wrapper = mount(MessageInput, {
      props: {
        modelValue: '',
        images: [],
        isConnected: true,
        isStarting: false,
        isRunning: true,
        pendingSteers: [],
      },
    })

    await wrapper.get('button[title="停止"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)

    await wrapper.setProps({ modelValue: '追加检查测试' })
    expect(wrapper.find('button[title="停止"]').exists()).toBe(false)
    expect(wrapper.get('button[title="追加指令"]').exists()).toBe(true)
  })
})
