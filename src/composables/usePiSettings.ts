import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ClientMessage, PiSettingsSnapshot } from '@shared/protocol'

type SendClientMessage = (message: ClientMessage) => boolean

export function usePiSettings(options: { sendClientMessage: SendClientMessage }) {
  const snapshot = ref<PiSettingsSnapshot | null>(null)
  const isOpen = ref(false)
  const isLoading = ref(false)
  const isSavingModels = ref(false)
  const isSavingSettings = ref(false)
  const isInstallingPi = ref(false)
  const closeConfirmOpen = ref(false)
  const closeAfterSaveAll = ref(false)
  const submittedModelsDraft = ref<string | null>(null)
  const submittedSettingsDraft = ref<string | null>(null)
  const modelsDraft = ref('')
  const settingsDraft = ref('')
  const modelsDirty = computed(() => (
    snapshot.value ? snapshot.value.models.content !== modelsDraft.value : false
  ))
  const settingsDirty = computed(() => (
    snapshot.value ? snapshot.value.settings.content !== settingsDraft.value : false
  ))

  function openSettings() {
    isOpen.value = true
    if (!snapshot.value || (!modelsDirty.value && !settingsDirty.value)) refreshSettings()
  }

  function closeSettings() {
    if (modelsDirty.value || settingsDirty.value) {
      closeConfirmOpen.value = true
      return
    }
    isOpen.value = false
  }

  function cancelCloseConfirmation() {
    closeConfirmOpen.value = false
  }

  function discardAndClose() {
    closeConfirmOpen.value = false
    resetModelsDraft()
    resetSettingsDraft()
    isOpen.value = false
  }

  function saveAllAndClose() {
    if (
      !snapshot.value
      || isLoading.value
      || isSavingModels.value
      || isSavingSettings.value
      || isInstallingPi.value
    ) return
    closeAfterSaveAll.value = true
    isSavingModels.value = true
    isSavingSettings.value = true
    submittedModelsDraft.value = modelsDraft.value
    submittedSettingsDraft.value = settingsDraft.value
    closeConfirmOpen.value = false
    if (!options.sendClientMessage({
      type: 'settings:save_all',
      models: modelsDraft.value,
      settings: settingsDraft.value,
    })) {
      closeAfterSaveAll.value = false
      isSavingModels.value = false
      isSavingSettings.value = false
      submittedModelsDraft.value = null
      submittedSettingsDraft.value = null
      toast.error('无法连接后端，设置保存失败')
    }
  }

  function refreshSettings() {
    if (isLoading.value || isSavingModels.value || isSavingSettings.value || isInstallingPi.value) return
    if (modelsDirty.value || settingsDirty.value) {
      toast.error('请先保存或还原配置更改')
      return
    }
    isLoading.value = true
    if (!options.sendClientMessage({ type: 'settings:get' })) {
      isLoading.value = false
      toast.error('无法连接后端，设置读取失败')
    }
  }

  function resetModelsDraft() {
    if (snapshot.value) modelsDraft.value = snapshot.value.models.content
  }

  function resetSettingsDraft() {
    if (snapshot.value) settingsDraft.value = snapshot.value.settings.content
  }

  function saveModels() {
    if (
      !snapshot.value
      || !modelsDirty.value
      || isLoading.value
      || isSavingModels.value
      || isSavingSettings.value
      || isInstallingPi.value
    ) return

    isSavingModels.value = true
    submittedModelsDraft.value = modelsDraft.value
    if (!options.sendClientMessage({ type: 'settings:save_models', content: modelsDraft.value })) {
      isSavingModels.value = false
      submittedModelsDraft.value = null
      toast.error('无法连接后端，models.json 保存失败')
    }
  }

  function saveSettings() {
    if (
      !snapshot.value
      || !settingsDirty.value
      || isLoading.value
      || isSavingModels.value
      || isSavingSettings.value
      || isInstallingPi.value
    ) return

    isSavingSettings.value = true
    submittedSettingsDraft.value = settingsDraft.value
    if (!options.sendClientMessage({ type: 'settings:save_settings', content: settingsDraft.value })) {
      isSavingSettings.value = false
      submittedSettingsDraft.value = null
      toast.error('无法连接后端，settings.json 保存失败')
    }
  }

  function installPi() {
    if (isLoading.value || isSavingModels.value || isSavingSettings.value || isInstallingPi.value) return
    isInstallingPi.value = true
    if (!options.sendClientMessage({ type: 'settings:install_pi' })) {
      isInstallingPi.value = false
      toast.error('无法连接后端，Pi 安装未启动')
    }
  }

  function cancelPendingSettingsRequests() {
    const hadPendingRequest = isLoading.value
      || isSavingModels.value
      || isSavingSettings.value
      || isInstallingPi.value
    clearPendingRequestState()
    if (hadPendingRequest) toast.error('后端连接已断开，未完成的设置操作已取消')
  }

  async function openSkillFolder(skillPath: string) {
    if (!window.piDesktop) return

    const folderPath = folderPathFromSkillPath(skillPath)
    const error = await window.piDesktop.openWorkspaceFolder(folderPath)
    if (error) toast.error(`无法打开 skill 文件夹：${error}`)
  }

  function applySnapshot(nextSnapshot: PiSettingsSnapshot) {
    const wasSavingModels = isSavingModels.value
    const wasSavingSettings = isSavingSettings.value
    const wasSavingAll = closeAfterSaveAll.value
    const wasModelsDirty = modelsDirty.value
    const wasSettingsDirty = settingsDirty.value
    const wasRefreshing = isLoading.value && !wasSavingModels && !wasSavingSettings
    const modelsChangedAfterSubmit = wasSavingModels
      && submittedModelsDraft.value !== null
      && modelsDraft.value !== submittedModelsDraft.value
    const settingsChangedAfterSubmit = wasSavingSettings
      && submittedSettingsDraft.value !== null
      && settingsDraft.value !== submittedSettingsDraft.value
    snapshot.value = nextSnapshot
    if (wasRefreshing || (wasSavingModels && !modelsChangedAfterSubmit) || !wasModelsDirty) {
      modelsDraft.value = nextSnapshot.models.content
    }
    if (wasRefreshing || (wasSavingSettings && !settingsChangedAfterSubmit) || !wasSettingsDirty) {
      settingsDraft.value = nextSnapshot.settings.content
    }
    isLoading.value = false
    isSavingModels.value = false
    isSavingSettings.value = false
    submittedModelsDraft.value = null
    submittedSettingsDraft.value = null
    isInstallingPi.value = nextSnapshot.install?.phase === 'running'
    if (closeAfterSaveAll.value) {
      closeAfterSaveAll.value = false
      if (modelsChangedAfterSubmit || settingsChangedAfterSubmit) {
        toast.success('已保存提交版本，后续修改仍未保存')
      } else {
        isOpen.value = false
      }
    }

    if (wasSavingModels && !wasSavingAll) toast.success('models.json 已保存')
    if (wasSavingSettings && !wasSavingAll) toast.success('settings.json 已保存')
  }

  function handleSettingsError(message: string) {
    clearPendingRequestState()
    toast.error(message)
  }

  function clearPendingRequestState() {
    // WebSocket 断开后不会再有响应；必须清掉本地请求锁，同时保留用户草稿供重试。
    closeAfterSaveAll.value = false
    isLoading.value = false
    isSavingModels.value = false
    isSavingSettings.value = false
    submittedModelsDraft.value = null
    submittedSettingsDraft.value = null
    isInstallingPi.value = false
  }

  return {
    closeSettings,
    cancelPendingSettingsRequests,
    cancelCloseConfirmation,
    closeConfirmOpen,
    discardAndClose,
    handleSettingsError,
    installPi,
    isInstallingPi,
    isLoading,
    isOpen,
    isSavingModels,
    isSavingSettings,
    modelsDirty,
    modelsDraft,
    openSettings,
    openSkillFolder,
    refreshSettings,
    resetModelsDraft,
    resetSettingsDraft,
    saveModels,
    saveAllAndClose,
    saveSettings,
    settingsDirty,
    settingsDraft,
    settingsSnapshot: snapshot,
    applySettingsSnapshot: applySnapshot,
  }
}

function folderPathFromSkillPath(skillPath: string): string {
  const normalized = skillPath.trim().replace(/\/+$/, '')
  const separator = normalized.lastIndexOf('/')
  if (separator <= 0) return normalized
  return normalized.slice(0, separator)
}
