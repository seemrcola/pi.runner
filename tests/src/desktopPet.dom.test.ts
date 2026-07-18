// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopPet from '../../src/features/desktop-pet/components/DesktopPet.vue'
import PixelPetOrb from '../../src/features/desktop-pet/components/PixelPetOrb.vue'
import PetWindowApp from '../../src/features/desktop-pet/host/PetWindowApp.vue'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'piPet')
})

describe('desktop pet components', () => {
  it.each(['coding', 'resting', 'thinking', 'walking'] as const)('renders the %s expression', (state) => {
    const wrapper = mount(PixelPetOrb, { props: { state } })

    expect(wrapper.attributes('aria-label')).toContain('像素球宠物')
    expect(wrapper.findAll('.pixel-pet-orb__eye')).toHaveLength(2)
    expect(wrapper.find('.pixel-pet-orb__mouth').exists()).toBe(true)
  })

  it('speaks when clicked and exposes a close intent', async () => {
    vi.useFakeTimers()
    const wrapper = mount(DesktopPet, {
      props: {
        dialogue: { resting: ['测试台词'] },
      },
    })

    await wrapper.get('.desktop-pet__character').trigger('click')
    await wrapper.get('.desktop-pet__close').trigger('click')

    expect(wrapper.emitted('speak')).toContainEqual(['测试台词'])
    expect(wrapper.emitted('state-change')).toContainEqual(['resting'])
    expect(wrapper.emitted('request-close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('lets every pet surface start a manual window drag', async () => {
    const beginDrag = vi.fn()
    const dragBy = vi.fn()
    const hide = vi.fn()
    Object.defineProperty(window, 'piPet', {
      configurable: true,
      value: { beginDrag, dragBy, hide, updateState: vi.fn() },
    })
    const wrapper = mount(PetWindowApp)
    const shell = wrapper.get('.pet-window-shell')
    const setPointerCapture = vi.fn()
    const dragTargets = [
      shell,
      wrapper.get('.desktop-pet__bubble'),
      wrapper.get('.desktop-pet__character'),
      wrapper.get('.desktop-pet__close'),
    ]

    for (const target of dragTargets) {
      Object.defineProperty(target.element, 'setPointerCapture', {
        configurable: true,
        value: setPointerCapture,
      })
      await target.trigger('pointerdown', {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        screenX: 100,
        screenY: 100,
      })
      expect(setPointerCapture).toHaveBeenCalledTimes(dragBy.mock.calls.length + 1)
      await shell.trigger('pointermove', {
        isPrimary: true,
        pointerId: 1,
        screenX: 106,
        screenY: 104,
      })
      await shell.trigger('pointerup', { isPrimary: true, pointerId: 1 })
    }

    expect(beginDrag).toHaveBeenCalledTimes(4)
    expect(dragBy).toHaveBeenCalledTimes(4)
    expect(setPointerCapture).toHaveBeenCalledTimes(4)
    expect(dragBy).toHaveBeenNthCalledWith(1, 6, 4)

    await wrapper.get('.desktop-pet__close').trigger('click')
    expect(hide).not.toHaveBeenCalled()
    await wrapper.get('.desktop-pet__close').trigger('click')
    expect(hide).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps pointer capture on the short-click button', async () => {
    const hide = vi.fn()
    Object.defineProperty(window, 'piPet', {
      configurable: true,
      value: { beginDrag: vi.fn(), dragBy: vi.fn(), hide, updateState: vi.fn() },
    })
    const wrapper = mount(PetWindowApp)
    const shell = wrapper.get('.pet-window-shell')
    const closeButton = wrapper.get('.desktop-pet__close')
    const setPointerCapture = vi.fn()
    Object.defineProperty(closeButton.element, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture,
    })

    await closeButton.trigger('pointerdown', {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      screenX: 100,
      screenY: 100,
    })
    await shell.trigger('pointerup', { isPrimary: true, pointerId: 1 })
    await closeButton.trigger('click')

    expect(setPointerCapture).toHaveBeenCalledWith(1)
    expect(hide).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('uses manual dragging so click actions remain available', () => {
    const host = readFileSync('src/features/desktop-pet/host/PetWindowApp.vue', 'utf8')

    expect(host).toContain('@pointerdown="handlePointerDown"')
    expect(host).toContain('@click.capture="handleClickCapture"')
    expect(host).not.toContain('app-drag')
    expect(host).not.toContain('-webkit-app-region')
  })
})
