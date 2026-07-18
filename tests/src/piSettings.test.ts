import { describe, expect, it, vi } from 'vitest'
import { usePiSettings } from '../../src/composables/usePiSettings'
import type { ClientMessage, PiSettingsSnapshot } from '../../shared/protocol'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

function snapshot(content = '{\n}\n'): PiSettingsSnapshot {
  return {
    pi: { installed: true, executablePath: '/usr/local/bin/pi' },
    models: {
      path: '/tmp/models.json',
      exists: true,
      content,
    },
    settings: {
      path: '/tmp/settings.json',
      exists: true,
      content: '{"skills":[]}\n',
    },
    skills: [],
    install: { phase: 'idle' },
  }
}

describe('Pi settings state', () => {
  it('does not refresh over unsaved drafts and can explicitly restore them', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })
    settings.applySettingsSnapshot(snapshot('{"model":"saved"}\n'))
    settings.modelsDraft.value = '{"model":"draft"}\n'

    settings.refreshSettings()

    expect(sent).toEqual([])
    expect(settings.modelsDraft.value).toBe('{"model":"draft"}\n')

    settings.resetModelsDraft()

    expect(settings.modelsDraft.value).toBe('{"model":"saved"}\n')
    expect(settings.modelsDirty.value).toBe(false)

    settings.closeSettings()
    settings.openSettings()

    expect(sent).toEqual([{ type: 'settings:get' }])
  })

  it('does not mark models dirty or save before the snapshot loads', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })

    expect(settings.modelsDirty.value).toBe(false)

    settings.saveModels()

    expect(sent).toEqual([])
  })

  it('saves models only after the loaded draft changes', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })

    settings.applySettingsSnapshot(snapshot('{"model":"a"}\n'))
    expect(settings.modelsDirty.value).toBe(false)

    settings.saveModels()
    expect(sent).toEqual([])

    settings.modelsDraft.value = '{"model":"b"}\n'
    settings.saveModels()

    expect(sent).toEqual([
      {
        type: 'settings:save_models',
        content: '{"model":"b"}\n',
      },
    ])
  })

  it('saves settings only after the loaded draft changes', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })

    settings.applySettingsSnapshot({
      ...snapshot(),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })
    expect(settings.settingsDirty.value).toBe(false)

    settings.saveSettings()
    expect(sent).toEqual([])

    settings.settingsDraft.value = '{"skills":["~/new-skills"]}\n'
    settings.saveSettings()

    expect(sent).toEqual([
      {
        type: 'settings:save_settings',
        content: '{"skills":["~/new-skills"]}\n',
      },
    ])
  })

  it('keeps settings.json content editable from the latest snapshot', () => {
    const settings = usePiSettings({
      sendClientMessage: () => true,
    })

    settings.applySettingsSnapshot({
      ...snapshot(),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/custom-skills"]}\n',
      },
    })

    expect(settings.settingsDraft.value).toBe('{"skills":["~/custom-skills"]}\n')
  })

  it('preserves unsaved settings edits when a models save snapshot arrives', () => {
    const settings = usePiSettings({
      sendClientMessage: () => true,
    })

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"old"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })
    settings.settingsDraft.value = '{"skills":["~/unsaved-skills"]}\n'
    settings.modelsDraft.value = '{"model":"new"}\n'
    settings.saveModels()

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"new"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })

    expect(settings.modelsDraft.value).toBe('{"model":"new"}\n')
    expect(settings.settingsDraft.value).toBe('{"skills":["~/unsaved-skills"]}\n')
  })

  it('updates clean settings draft when a models save snapshot includes newer settings content', () => {
    const settings = usePiSettings({
      sendClientMessage: () => true,
    })

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"old"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })
    settings.modelsDraft.value = '{"model":"new"}\n'
    settings.saveModels()

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"new"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/newer-skills"]}\n',
      },
    })

    expect(settings.modelsDraft.value).toBe('{"model":"new"}\n')
    expect(settings.settingsDraft.value).toBe('{"skills":["~/newer-skills"]}\n')
  })

  it('preserves unsaved model edits when a settings save snapshot arrives', () => {
    const settings = usePiSettings({
      sendClientMessage: () => true,
    })

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"old"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })
    settings.modelsDraft.value = '{"model":"unsaved"}\n'
    settings.settingsDraft.value = '{"skills":["~/new-skills"]}\n'
    settings.saveSettings()

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"old"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/new-skills"]}\n',
      },
    })

    expect(settings.modelsDraft.value).toBe('{"model":"unsaved"}\n')
    expect(settings.settingsDraft.value).toBe('{"skills":["~/new-skills"]}\n')
  })

  it('updates clean models draft when a settings save snapshot includes newer models content', () => {
    const settings = usePiSettings({
      sendClientMessage: () => true,
    })

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"old"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/old-skills"]}\n',
      },
    })
    settings.settingsDraft.value = '{"skills":["~/new-skills"]}\n'
    settings.saveSettings()

    settings.applySettingsSnapshot({
      ...snapshot('{"model":"newer"}\n'),
      settings: {
        path: '/tmp/settings.json',
        exists: true,
        content: '{"skills":["~/new-skills"]}\n',
      },
    })

    expect(settings.modelsDraft.value).toBe('{"model":"newer"}\n')
    expect(settings.settingsDraft.value).toBe('{"skills":["~/new-skills"]}\n')
  })

  it('serializes independent config saves so one snapshot cannot consume the other request', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"new"}\n'
    settings.settingsDraft.value = '{"theme":"new"}\n'

    settings.saveModels()
    settings.saveSettings()
    settings.saveAllAndClose()

    expect(sent).toEqual([
      { type: 'settings:save_models', content: '{"model":"new"}\n' },
    ])
    expect(settings.isSavingModels.value).toBe(true)
    expect(settings.isSavingSettings.value).toBe(false)
  })

  it('preserves edits made after a config save was submitted', () => {
    const settings = usePiSettings({ sendClientMessage: () => true })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"submitted"}\n'

    settings.saveModels()
    settings.modelsDraft.value = '{"model":"newer-draft"}\n'
    settings.applySettingsSnapshot(snapshot('{"model":"submitted"}\n'))

    expect(settings.modelsDraft.value).toBe('{"model":"newer-draft"}\n')
    expect(settings.modelsDirty.value).toBe(true)
    expect(settings.isSavingModels.value).toBe(false)
  })

  it('keeps settings open when drafts change after save-all submission', () => {
    const settings = usePiSettings({ sendClientMessage: () => true })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.isOpen.value = true
    settings.modelsDraft.value = '{"model":"submitted"}\n'

    settings.saveAllAndClose()
    settings.modelsDraft.value = '{"model":"newer-draft"}\n'
    settings.applySettingsSnapshot(snapshot('{"model":"submitted"}\n'))

    expect(settings.isOpen.value).toBe(true)
    expect(settings.modelsDraft.value).toBe('{"model":"newer-draft"}\n')
    expect(settings.modelsDirty.value).toBe(true)
  })

  it('does not start config operations while Pi installation is running', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"new"}\n'

    settings.installPi()
    settings.saveModels()
    settings.refreshSettings()
    settings.saveAllAndClose()

    expect(sent).toEqual([{ type: 'settings:install_pi' }])
    expect(settings.isInstallingPi.value).toBe(true)
    expect(settings.isSavingModels.value).toBe(false)
    expect(settings.isLoading.value).toBe(false)
  })

  it('cancels an in-flight settings request on disconnect without losing the draft', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"retry-me"}\n'
    settings.saveModels()

    settings.cancelPendingSettingsRequests()

    expect(settings.isSavingModels.value).toBe(false)
    expect(settings.modelsDraft.value).toBe('{"model":"retry-me"}\n')
    expect(settings.modelsDirty.value).toBe(true)

    settings.saveModels()
    expect(sent).toEqual([
      { type: 'settings:save_models', content: '{"model":"retry-me"}\n' },
      { type: 'settings:save_models', content: '{"model":"retry-me"}\n' },
    ])
  })

  it('opens a close confirmation for dirty drafts and can save all before closing', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({
      sendClientMessage: (message) => { sent.push(message); return true },
    })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"new"}\n'
    settings.openSettings()
    settings.closeSettings()

    expect(settings.closeConfirmOpen.value).toBe(true)
    settings.saveAllAndClose()

    expect(sent.at(-1)).toEqual({
      type: 'settings:save_all',
      models: '{"model":"new"}\n',
      settings: '{"skills":[]}\n',
    })
    expect(settings.isOpen.value).toBe(true)
    settings.applySettingsSnapshot(snapshot('{"model":"new"}\n'))
    expect(settings.isOpen.value).toBe(false)
    expect(settings.modelsDirty.value).toBe(false)
    expect(settings.settingsDirty.value).toBe(false)
  })

  it('keeps settings open after save-all fails and after a later snapshot arrives', () => {
    const settings = usePiSettings({ sendClientMessage: () => true })
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))
    settings.modelsDraft.value = '{"model":"draft"}\n'
    settings.openSettings()
    settings.closeSettings()
    settings.saveAllAndClose()

    settings.handleSettingsError('models.json 保存失败')
    settings.applySettingsSnapshot(snapshot('{"model":"old"}\n'))

    expect(settings.isOpen.value).toBe(true)
    expect(settings.modelsDraft.value).toBe('{"model":"draft"}\n')
    expect(settings.modelsDirty.value).toBe(true)
  })

  it('can discard dirty drafts without sending a save', () => {
    const sent: ClientMessage[] = []
    const settings = usePiSettings({ sendClientMessage: (message) => { sent.push(message); return true } })
    settings.applySettingsSnapshot(snapshot())
    settings.settingsDraft.value = '{"skills":["draft"]}\n'
    settings.openSettings()
    settings.closeSettings()
    settings.discardAndClose()
    expect(settings.isOpen.value).toBe(false)
    expect(sent).toEqual([])
  })
})
