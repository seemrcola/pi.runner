import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import MessageInput from '@/components/chat/MessageInput.vue'
import MessageList from '@/components/message/MessageList.vue'
import { useBackendEvents } from '@/composables/useBackendEvents'
import { useConversationLifecycle } from '@/composables/useConversationLifecycle'
import { useConversationMessages } from '@/composables/useConversationMessages'
import { usePiSettings } from '@/composables/usePiSettings'
import { useHistorySync } from '@/composables/useHistorySync'
import { useWorkspaceViewState } from '@/composables/useWorkspaceViewState'
import { createBackendSocketClient } from '@/lib/backendSocket'
import {
  createConversationRuntime,
  displayStatusForSnapshot,
  isRunnerBusy,
  isRunnerStarting,
  runnerError,
  type ConversationRuntime,
  type ConversationRuntimeStatus,
} from '@/lib/conversationRuntime'
import type { Conversation, ImageContent } from '@shared/chat'
import type { PiRunnerSnapshot } from '@shared/protocol'

export type AppSessionShellTemplateRefs = {
  inputRef: Ref<InstanceType<typeof MessageInput> | null>
  messageListRef: Ref<InstanceType<typeof MessageList> | null>
}

export function useAppSessionShell(templateRefs?: AppSessionShellTemplateRefs) {
  const isConnected = ref(false)
  const connectionState = ref<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting')
  const defaultWorkspacePath = ref('')
  const homePath = ref('')
  const showAddDialog = ref(false)

  const conversations = ref<Conversation[]>([])
  const activeId = ref<string | null>(null)
  const expandedWorkspaces = ref(new Set<string>())
  const runtimes = ref(new Map<string, ConversationRuntime>())
  const runnerSnapshots = ref(new Map<string, PiRunnerSnapshot>())
  const runnerStateKnown = ref(false)

  let backendSocket: ReturnType<typeof createBackendSocketClient> | null = null
  let seq = 0

  const messageListRef = templateRefs?.messageListRef ?? ref<InstanceType<typeof MessageList> | null>(null)
  const inputRef = templateRefs?.inputRef ?? ref<InstanceType<typeof MessageInput> | null>(null)

  const activeConversation = computed(
    () => conversations.value.find((c) => c.id === activeId.value) ?? null,
  )
  const isEmptyState = computed(() => conversations.value.length === 0)
  const activeMessages = computed(() => activeConversation.value?.messages ?? [])
  const activeTurns = computed(() => activeConversation.value?.turns ?? [])
  const activeRuntimeState = computed(() => (activeId.value ? runtimeFor(activeId.value) : null))
  const activeRunnerSnapshot = computed(() => (activeId.value ? runnerSnapshots.value.get(activeId.value) : undefined))
  const activeDraft = computed({
    get: () => activeRuntimeState.value?.draft ?? '',
    set: (value: string) => {
      if (activeRuntimeState.value) activeRuntimeState.value.draft = value
    },
  })
  const activeDraftImages = computed({
    get: () => activeRuntimeState.value?.draftImages ?? [],
    set: (value: ImageContent[]) => {
      if (activeRuntimeState.value) activeRuntimeState.value.draftImages = value
    },
  })
  const activeIsStarting = computed(() => isRunnerStarting(activeRunnerSnapshot.value))
  const activeIsRunning = computed(() => isRunnerBusy(activeRunnerSnapshot.value))
  const activePendingSteers = computed(() => activeRuntimeState.value?.pendingSteers ?? [])
  const activeCwd = computed(() => {
    const conversation = activeConversation.value
    if (!conversation) return ''
    if (conversation.kind === 'session') return homePath.value
    return conversation.workspacePath || defaultWorkspacePath.value
  })
  const activeRuntimeError = computed(() => runnerError(activeRunnerSnapshot.value))
  const conversationStatuses = computed<Record<string, ConversationRuntimeStatus>>(() => {
    const statuses: Record<string, ConversationRuntimeStatus> = {}
    for (const conversation of conversations.value) {
      statuses[conversation.id] = displayStatusForSnapshot(runnerSnapshots.value.get(conversation.id))
    }
    return statuses
  })
  const activeTaskCount = computed(() => [...runnerSnapshots.value.values()].filter((snapshot) => (
    snapshot.phase === 'starting'
    || snapshot.phase === 'running'
    || snapshot.phase === 'stopping'
    || snapshot.phase === 'terminating'
    || snapshot.phase === 'termination_failed'
  )).length)

  const {
    cancelHistorySync,
    handleHistorySyncMessage,
    isHistorySyncing,
    refreshHistory,
  } = useHistorySync({
    isConnected,
    activeTaskCount,
    sendClientMessage,
  })

  function runtimeFor(conversationId: string): ConversationRuntime {
    const existing = runtimes.value.get(conversationId)
    if (existing) return existing

    const runtime = createConversationRuntime()
    runtimes.value.set(conversationId, runtime)
    return runtime
  }

  function conversationById(conversationId: string): Conversation | null {
    return conversations.value.find((conversation) => conversation.id === conversationId) ?? null
  }

  function nextMessageId(): string {
    return `msg-${++seq}`
  }

  const {
    applySettingsSnapshot,
    cancelPendingSettingsRequests,
    closeSettings,
    closeConfirmOpen,
    cancelCloseConfirmation,
    discardAndClose,
    handleSettingsError,
    installPi,
    isInstallingPi,
    isLoading: isSettingsLoading,
    isOpen: isSettingsOpen,
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
    saveSettings,
    saveAllAndClose,
    settingsDirty,
    settingsDraft,
    settingsSnapshot,
  } = usePiSettings({
    sendClientMessage,
  })

  const {
    updateWorkspaceViewState,
    workspaceViewStates,
  } = useWorkspaceViewState({
    sendClientMessage,
    onUpdateError: (message) => toast.error(message),
  })

  const {
    appendAssistantDelta,
    appendThinkingDelta,
    endThinking,
    finalizeAssistantTurn,
    flushNow,
    pushMessage,
    upsertAssistantTool,
  } = useConversationMessages({
    conversationById,
    runtimeFor,
    isActive: (conversationId) => conversationId === activeId.value,
    nextMessageId,
    scrollToBottom,
  })

  const {
    addWorkspaceConversation,
    cancelPi,
    chooseWorkspaceFolder,
    confirmOptimisticDelete,
    confirmOptimisticRestore,
    deleteConversation,
    deleteWorkspace,
    exportConversation,
    openWorkspaceFolder,
    rejectOptimisticRestore,
    removeSteer,
    requestConversationHistory,
    rollbackOptimisticDelete,
    restoreConversations,
    sendMessage,
    sendPendingStartPrompt,
    sendPendingSteersAsFollowUp,
    startSessionOnly,
    submitPendingSteer,
    switchConversation,
  } = useConversationLifecycle({
    conversations,
    activeId,
    expandedWorkspaces,
    runtimes,
    showAddDialog,
    defaultWorkspacePath,
    homePath,
    isConnected,
    inputRef,
    runtimeFor,
    runnerSnapshotFor: (conversationId) => runnerSnapshots.value.get(conversationId),
    conversationById,
    flushNow,
    finalizeAssistantTurn,
    pushMessage,
    forceScrollToBottom,
    notify: {
      success: (message, options) => toast.success(message, options),
      error: (message) => toast.error(message),
    },
    sendClientMessage,
  })

  const {
    markRuntimesDisconnected,
    onBackendMessage,
  } = useBackendEvents({
    activeId,
    conversations,
    expandedWorkspaces,
    runtimes,
    runnerSnapshots,
    workspaceViewStates,
    runtimeFor,
    restoreConversations,
    requestConversationHistory,
    confirmOptimisticDelete,
    confirmOptimisticRestore,
    rejectOptimisticRestore,
    rollbackOptimisticDelete,
    sendPendingStartPrompt,
    sendPendingSteersAsFollowUp,
    appendAssistantDelta,
    appendThinkingDelta,
    endThinking,
    finalizeAssistantTurn,
    flushNow,
    pushMessage,
    upsertAssistantTool,
    applySettingsSnapshot,
    handleSettingsError,
    onRunnerList() {
      runnerStateKnown.value = true
    },
  })

  onMounted(() => {
    void connectBackend()
  })

  watch(activeId, (conversationId) => {
    sendClientMessage({ type: 'set_active_conversation', conversationId })
  })

  watch(
    [runnerStateKnown, activeTaskCount, modelsDirty, settingsDirty],
      ([known, count, isModelsDirty, isSettingsDirty]) => window.piDesktop?.updateTaskSummary({
        known,
        activeTaskCount: count,
        hasUnsavedSettings: isModelsDirty || isSettingsDirty,
      }),
    { immediate: true },
  )

  onBeforeUnmount(() => {
    for (const runtime of runtimes.value.values()) {
      if (runtime.rafId != null) cancelAnimationFrame(runtime.rafId)
    }
    backendSocket?.close()
  })

  async function connectBackend() {
    if (!window.piDesktop) return

    defaultWorkspacePath.value = await window.piDesktop.getDefaultWorkspacePath()
    homePath.value = await window.piDesktop.getHomePath()
    backendSocket = createBackendSocketClient({
      getUrl: () => window.piDesktop.getBackendUrl(),
      onConnected() {
        isConnected.value = true
        connectionState.value = 'connected'
        runnerStateKnown.value = false
        requestConversationHistory()
        sendClientMessage({ type: 'list_runners' })
        sendClientMessage({ type: 'set_active_conversation', conversationId: activeId.value })
        sendClientMessage({ type: 'list_workspace_view_states' })
        if (isSettingsOpen.value) refreshSettings()
      },
      onDisconnected() {
        isConnected.value = false
        runnerStateKnown.value = false
        cancelHistorySync()
        cancelPendingSettingsRequests()
        markRuntimesDisconnected()
      },
      onStateChange(state) {
        connectionState.value = state
      },
      onMessage(message) {
        handleHistorySyncMessage(message)
        onBackendMessage(message)
      },
      onError(error) {
        if (activeId.value) pushMessage(activeId.value, 'error', error.message)
      },
    })
    await backendSocket.connect()
  }

  function sendClientMessage(message: Parameters<ReturnType<typeof createBackendSocketClient>['send']>[0]): boolean {
    return backendSocket?.send(message) ?? false
  }

  function newConversation() {
    showAddDialog.value = true
  }

  function scrollToBottom() {
    messageListRef.value?.scrollToBottom()
  }

  function forceScrollToBottom() {
    messageListRef.value?.forceScrollToBottom()
  }

  function scrollToMessage(messageId: string) {
    messageListRef.value?.scrollToMessage(messageId)
  }

  return {
    activeConversation,
    activeCwd,
    activeDraft,
    activeDraftImages,
    activeIsRunning,
    activeIsStarting,
    activeMessages,
    activePendingSteers,
    activeRuntimeError,
    activeTurns,
    activeTaskCount,
    activeId,
    addWorkspaceConversation,
    cancelPi,
    chooseWorkspaceFolder,
    closeSettings,
    closeConfirmOpen,
    cancelCloseConfirmation,
    discardAndClose,
    conversationStatuses,
    connectionState,
    conversations,
    deleteConversation,
    deleteWorkspace,
    expandedWorkspaces,
    exportConversation,
    inputRef,
    isConnected,
    isEmptyState,
    isInstallingPi,
    isHistorySyncing,
    isSettingsLoading,
    isSettingsOpen,
    isSavingModels,
    isSavingSettings,
    messageListRef,
    modelsDirty,
    modelsDraft,
    newConversation,
    openSettings,
    openSkillFolder,
    openWorkspaceFolder,
    refreshSettings,
    resetModelsDraft,
    resetSettingsDraft,
    removeSteer,
    scrollToMessage,
    sendMessage,
    showAddDialog,
    startSessionOnly,
    submitPendingSteer,
    switchConversation,
    refreshHistory,
    saveModels,
    saveSettings,
    saveAllAndClose,
    settingsDirty,
    settingsDraft,
    installPi,
    settingsSnapshot,
    updateWorkspaceViewState,
    workspaceViewStates,
  }
}
