// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import { nextTick } from 'vue'
import CommandPalette from '../../src/components/chat/CommandPalette.vue'
import type { CommandPaletteItem } from '../../src/lib/commandPalette'

function readSource(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('command palette integration', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('wires the command palette through App without adding backend lifecycle commands', () => {
    const app = readSource('../../src/App.vue')

    expect(app).toContain("import CommandPalette from '@/components/chat/CommandPalette.vue'")
    expect(app).toContain("buildCommandPaletteItems, type CommandPaletteItem } from '@/lib/commandPalette'")
    expect(app).toContain('const isCommandPaletteOpen = ref(false)')
    expect(app).toContain('const commandPaletteItems = computed(() =>')
    expect(app).toContain('function handleCommandPaletteSelect')
    expect(app).toContain('window.addEventListener')
    expect(app).toContain("event.key.toLowerCase() === 'k'")
    expect(app).toContain('<CommandPalette')
    expect(app).toContain(':items="commandPaletteItems"')
    expect(app).toContain('@select="handleCommandPaletteSelect"')
    expect(app).toContain('@command-palette="openCommandPalette"')
    expect(app).toContain('function openCommandPalette()')
    expect(app).toContain('function runAfterSettingsClose')
    expect(app).toContain('if (isSettingsOpen.value) return')
    expect(app).toContain('closeImageViewer(false)')
    expect(app).not.toContain("type: 'rpc_command'")
    expect(app).not.toContain("type: 'clone_session'")
  })

  test('filters commands and executes the active result with Enter', async () => {
    const items: CommandPaletteItem[] = [
      {
        id: 'new-conversation',
        title: '新建会话',
        subtitle: '开始任务',
        group: '操作',
        keywords: ['new'],
        actionId: 'new-conversation',
      },
      {
        id: 'open-settings',
        title: '打开设置',
        subtitle: '编辑配置',
        group: '操作',
        keywords: ['settings'],
        actionId: 'open-settings',
      },
    ]
    const wrapper = mount(CommandPalette, {
      attachTo: document.body,
      props: { open: true, items },
    })
    await nextTick()
    const input = document.querySelector<HTMLInputElement>('input[placeholder="搜索会话、工作区或操作"]')!

    input.value = 'settings'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await nextTick()

    expect(wrapper.emitted('select')).toContainEqual([items[1]])
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  test('keeps the command palette search box anchored near the top of the window', () => {
    const palette = readSource('../../src/components/chat/CommandPalette.vue')

    expect(palette).toContain('top-[14vh]')
    expect(palette).toContain('translate-y-0')
    expect(palette).not.toContain('top-1/2 z-50')
  })
})
