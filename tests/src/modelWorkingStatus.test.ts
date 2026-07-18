// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import MessageList from '../../src/components/message/MessageList.vue'

describe('model working status UI', () => {
  test('MessageList renders a quiet footer status only while the model is working', async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [], turns: [], isRunning: true },
    })

    expect(wrapper.get('[data-testid="agent-working-status"]').text()).toContain('Pi 仍在工作')

    await wrapper.setProps({ isRunning: false })
    expect(wrapper.find('[data-testid="agent-working-status"]').exists()).toBe(false)
  })
})
