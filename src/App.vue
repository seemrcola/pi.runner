<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderOpen, Inbox, MessageCircle } from '@lucide/vue'
import Sidebar from '@/components/chat/Sidebar.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import CommandPalette from '@/components/chat/CommandPalette.vue'
import MessageInput from '@/components/chat/MessageInput.vue'
import SettingsView from '@/components/settings/SettingsView.vue'
import TimelineNavigator from '@/components/chat/TimelineNavigator.vue'
import MessageList from '@/components/message/MessageList.vue'
import { Toaster } from '@/components/ui/sonner'
import { ImageViewerOverlay } from '@/components/image-viewer'
import { useAppSessionShell } from '@/composables/useAppSessionShell'
import { buildCommandPaletteItems, type CommandPaletteItem } from '@/lib/commandPalette'
import { createImageViewerState } from '@/lib/imageViewerState'

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const inputRef = ref<InstanceType<typeof MessageInput> | null>(null)
const isCommandPaletteOpen = ref(false)
const imageViewer = createImageViewerState()
let imageViewerTrigger: HTMLButtonElement | null = null

const {
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
  isConnected,
  isEmptyState,
  isInstallingPi,
  isHistorySyncing,
  isSettingsLoading,
  isSettingsOpen,
  isSavingModels,
  isSavingSettings,
  modelsDirty,
  modelsDraft,
  newConversation,
  openSettings,
  openSkillFolder,
  openWorkspaceFolder,
  refreshSettings,
  removeSteer,
  scrollToMessage,
  sendMessage,
  saveModels,
  saveSettings,
  saveAllAndClose,
  resetModelsDraft,
  resetSettingsDraft,
  settingsDirty,
  settingsDraft,
  showAddDialog,
  settingsSnapshot,
  startSessionOnly,
  submitPendingSteer,
  switchConversation,
  refreshHistory,
  installPi,
  updateWorkspaceViewState,
  workspaceViewStates,
} = useAppSessionShell({
  inputRef,
  messageListRef,
})

const commandPaletteItems = computed(() =>
  buildCommandPaletteItems({
    conversations: conversations.value,
    conversationStatuses: conversationStatuses.value,
    isConnected: isConnected.value,
    activeTaskCount: activeTaskCount.value,
    isHistorySyncing: isHistorySyncing.value,
  }),
)

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    closeImageViewer(false)
    isCommandPaletteOpen.value = true
  }
}

function openCommandPalette() {
  closeImageViewer(false)
  isCommandPaletteOpen.value = true
}

function showPet() {
  window.piDesktop?.showPet()
}

function updateImageViewerOpen(open: boolean) {
  if (!open) closeImageViewer()
}

function openImageViewer(images: Parameters<typeof imageViewer.open>[0], index: number, trigger: HTMLButtonElement) {
  imageViewerTrigger = trigger
  imageViewer.open(images, index)
}

function restoreImageTriggerFocus() {
  const trigger = imageViewerTrigger
  imageViewerTrigger = null
  nextTick(() => trigger?.isConnected && trigger.focus())
}

function closeImageViewer(restoreFocus = true) {
  if (!imageViewer.isOpen.value) return
  imageViewer.close()
  if (restoreFocus) restoreImageTriggerFocus()
  else imageViewerTrigger = null
}

function handleCommandPaletteSelect(item: CommandPaletteItem) {
  if (item.disabled) return
  closeImageViewer(false)

  switch (item.actionId) {
    case 'new-conversation':
      runAfterSettingsClose(newConversation)
      break
    case 'start-session-only':
      runAfterSettingsClose(startSessionOnly)
      break
    case 'choose-workspace':
      runAfterSettingsClose(chooseWorkspaceFolder)
      break
    case 'refresh-history':
      refreshHistory()
      break
    case 'open-settings':
      openSettings()
      break
    case 'switch-conversation':
      if (item.conversationId) {
        runAfterSettingsClose(() => switchConversation(item.conversationId!))
      }
      break
  }
}

function runAfterSettingsClose(action: () => void) {
  closeSettings()
  if (isSettingsOpen.value) return
  action()
}
</script>

<template>
  <Toaster />
  <ImageViewerOverlay
    :open="imageViewer.isOpen.value"
    :active-image="imageViewer.activeImage.value"
    :image-count="imageViewer.images.value.length"
    :position-label="imageViewer.positionLabel.value"
    @update:open="updateImageViewerOpen"
    @previous="imageViewer.previous()"
    @next="imageViewer.next()"
  />
  <CommandPalette
    v-model:open="isCommandPaletteOpen"
    :items="commandPaletteItems"
    @select="handleCommandPaletteSelect"
  />
  <main v-if="isSettingsOpen" class="h-screen overflow-hidden bg-background">
    <SettingsView
      v-model:models-draft="modelsDraft"
      v-model:settings-draft="settingsDraft"
      :snapshot="settingsSnapshot"
      :is-connected="isConnected"
      :models-dirty="modelsDirty"
      :settings-dirty="settingsDirty"
      :is-loading="isSettingsLoading"
      :is-saving-models="isSavingModels"
      :is-saving-settings="isSavingSettings"
      :is-installing-pi="isInstallingPi"
      :close-confirm-open="closeConfirmOpen"
      @refresh="refreshSettings"
      @reset-models="resetModelsDraft"
      @reset-settings="resetSettingsDraft"
      @save-models="saveModels"
      @save-settings="saveSettings"
      @install-pi="installPi"
      @open-skill-folder="openSkillFolder"
      @close="closeSettings"
      @cancel-close-confirmation="cancelCloseConfirmation"
      @discard-and-close="discardAndClose"
      @save-all-and-close="saveAllAndClose"
    />
  </main>

  <main v-else class="grid h-screen grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden bg-border">
    <!-- 左侧：对话列表 -->
      <Sidebar
        :conversations="conversations"
        :active-id="activeId"
        :is-connected="isConnected"
        :active-task-count="activeTaskCount"
        :is-history-syncing="isHistorySyncing"
        :show-add-dialog="showAddDialog"
        :expanded-workspaces="expandedWorkspaces"
        :workspace-view-states="workspaceViewStates"
        :conversation-statuses="conversationStatuses"
      @choose-workspace="chooseWorkspaceFolder"
      @start-session-only="startSessionOnly"
      @close-add-dialog="showAddDialog = false"
      @update-expanded-workspaces="expandedWorkspaces = $event"
      @update-workspace-view-state="updateWorkspaceViewState"
      @add-workspace-conversation="addWorkspaceConversation"
      @select="switchConversation"
      @export="exportConversation"
      @delete="deleteConversation"
      @delete-workspace="deleteWorkspace"
      @open-workspace-folder="openWorkspaceFolder"
      @refresh-history="refreshHistory"
    />

    <!-- 右侧：对话区 -->
    <section class="relative flex min-w-0 flex-col overflow-hidden bg-background">
      <ChatHeader
        :is-connected="isConnected"
        :connection-state="connectionState"
        :is-starting="activeIsStarting"
        :is-running="activeIsRunning"
        :cwd="activeCwd"
        :runtime-error="activeRuntimeError"
        :conversation-title="activeConversation?.title ?? ''"
        :conversation-kind="activeConversation?.kind ?? 'session'"
        @new-conversation="newConversation"
        @command-palette="openCommandPalette"
        @pet="showPet"
        @settings="openSettings"
      />

      <!-- 消息区 -->
      <div class="relative flex min-h-0 min-w-0 flex-1">
        <TimelineNavigator
          v-if="!isEmptyState"
          :messages="activeMessages"
          :turns="activeTurns"
          @select="scrollToMessage"
        />
        <MessageList
          v-if="!isEmptyState"
          ref="messageListRef"
          :messages="activeMessages"
          :turns="activeTurns"
          :is-running="activeIsRunning"
          @open-image-viewer="openImageViewer"
        />
        <div v-else class="flex min-w-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <div class="flex max-w-sm flex-col items-center gap-5">
            <Inbox class="size-10" />
            <div class="space-y-2">
              <div class="text-sm font-semibold text-foreground mb-4">还没有会话</div>
              <div class="flex items-center justify-center gap-2">
                <button
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-secondary px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-secondary"
                  :disabled="!isConnected"
                  :title="isConnected ? '开始普通会话' : '后端未连接'"
                  @click="startSessionOnly"
                >
                  <MessageCircle class="size-3.5" />
                  普通会话
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-secondary px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-secondary"
                  :disabled="!isConnected"
                  :title="isConnected ? '选择工作区' : '后端未连接'"
                  @click="chooseWorkspaceFolder"
                >
                  <FolderOpen class="size-3.5" />
                  选择工作区
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <MessageInput
        v-if="!isEmptyState"
        ref="inputRef"
        v-model="activeDraft"
        v-model:images="activeDraftImages"
        :is-connected="isConnected"
        :is-starting="activeIsStarting"
        :is-running="activeIsRunning"
        :pending-steers="activePendingSteers"
        @send="sendMessage"
        @stop="cancelPi"
        @submit-steer="submitPendingSteer"
        @remove-steer="removeSteer"
        @open-image-viewer="openImageViewer"
      />
    </section>
  </main>
</template>
