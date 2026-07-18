<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, CheckCircle2, Download, ExternalLink, RefreshCcw, RotateCcw, Save, XCircle } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PiSettingsSnapshot } from '@shared/protocol'

defineProps<{
  snapshot: PiSettingsSnapshot | null
  isConnected: boolean
  modelsDraft: string
  settingsDraft: string
  modelsDirty: boolean
  settingsDirty: boolean
  isLoading: boolean
  isSavingModels: boolean
  isSavingSettings: boolean
  isInstallingPi: boolean
  closeConfirmOpen: boolean
}>()

const installConfirmOpen = ref(false)

const emit = defineEmits<{
  'update:modelsDraft': [value: string]
  'update:settingsDraft': [value: string]
  refresh: []
  saveModels: []
  saveSettings: []
  resetModels: []
  resetSettings: []
  installPi: []
  openSkillFolder: [path: string]
  close: []
  'discard-and-close': []
  'save-all-and-close': []
  'cancel-close-confirmation': []
}>()

function requestInstall() {
  installConfirmOpen.value = true
}
</script>

<template>
  <ScrollArea class="h-full bg-background">
    <Dialog :open="closeConfirmOpen" @update:open="(open) => !open && emit('cancel-close-confirmation')">
      <DialogContent class="rounded-sm">
        <DialogHeader>
          <DialogTitle>放弃未保存的设置？</DialogTitle>
          <DialogDescription>当前修改尚未保存，返回后这些修改会丢失。</DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="emit('cancel-close-confirmation')">继续编辑</Button>
          <Button variant="secondary" @click="emit('discard-and-close')">放弃修改</Button>
          <Button
            :disabled="isLoading || isSavingModels || isSavingSettings || isInstallingPi"
            @click="emit('save-all-and-close')"
          >
            保存并返回
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog :open="installConfirmOpen" @update:open="installConfirmOpen = $event">
      <DialogContent class="rounded-sm">
        <DialogHeader>
          <DialogTitle>确认安装 Pi？</DialogTitle>
          <DialogDescription>
            将从 pi.dev 下载并执行官方安装脚本，可能修改 Pi 命令和 PATH。请确认你信任此来源。
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <DialogClose as-child><Button variant="ghost">取消</Button></DialogClose>
          <Button @click="installConfirmOpen = false; emit('installPi')">继续安装</Button>
        </div>
      </DialogContent>
    </Dialog>
    <div
      class="flex min-h-full w-full min-w-0 flex-col bg-background"
    >
      <div class="sticky top-0 z-10 h-14 shrink-0 border-b border-border bg-background">
        <div class="app-drag mx-auto flex h-full w-[75vw] items-center justify-between max-lg:w-[calc(100vw-32px)]">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                class="app-no-drag size-7 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="返回会话"
                @click="emit('close')"
              >
                <ArrowLeft class="size-3.5" />
              </Button>
              <div>
                <h1 class="text-sm font-semibold text-foreground">设置</h1>
                <p class="mt-0.5 text-xs text-muted-foreground">Pi 安装、模型配置和 skills</p>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="app-no-drag h-8 rounded-sm text-xs text-muted-foreground hover:text-foreground"
            :disabled="!isConnected || isLoading || isSavingModels || isSavingSettings || modelsDirty || settingsDirty"
            :title="!isConnected ? '后端未连接' : modelsDirty || settingsDirty ? '请先保存或还原配置更改' : '刷新设置'"
            @click="emit('refresh')"
          >
            <RefreshCcw class="size-3.5" />
            刷新
          </Button>
        </div>
      </div>

      <div class="min-h-0 flex-1 py-5">
        <div class="mx-auto flex w-[75vw] flex-col gap-5 max-lg:w-[calc(100vw-32px)]">
        <div
          v-if="!isConnected || !snapshot"
          class="flex min-h-[320px] flex-col items-center justify-center rounded-sm border border-border bg-card px-6 text-center"
          role="status"
        >
          <RefreshCcw v-if="isConnected && isLoading" class="mb-4 size-5 animate-spin text-muted-foreground" />
          <XCircle v-else class="mb-4 size-5 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">
            {{ isConnected && isLoading ? '正在读取 Pi 设置…' : '暂时无法连接后端' }}
          </h2>
          <p class="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {{ isConnected && isLoading ? '正在获取安装、配置和 skills 状态。' : '连接恢复后重试，现有本地设置不会被修改。' }}
          </p>
          <Button
            v-if="isConnected && !isLoading"
            variant="secondary"
            size="sm"
            class="mt-4 h-8 rounded-sm text-xs"
            @click="emit('refresh')"
          >
            <RefreshCcw class="size-3.5" />
            重试
          </Button>
        </div>
        <template v-else>
        <section class="rounded-sm border border-border bg-card">
          <div class="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-foreground">Pi 安装</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ snapshot?.pi.installed ? snapshot.pi.executablePath : '未检测到 pi 命令' }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <div
                :class="[
                  'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs',
                  snapshot?.pi.installed
                    ? 'border-green-500/30 bg-green-500/10 text-green-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                ]"
              >
                <CheckCircle2 v-if="snapshot?.pi.installed" class="size-3.5" />
                <XCircle v-else class="size-3.5" />
                {{ snapshot?.pi.installed ? '已安装' : '未安装' }}
              </div>
              <Button
                v-if="!snapshot?.pi.installed"
                size="sm"
                class="h-8 rounded-sm text-xs"
                :disabled="isLoading || isSavingModels || isSavingSettings || isInstallingPi"
                @click="requestInstall"
              >
                <Download class="size-3.5" />
                {{ isInstallingPi ? '安装中' : '一键安装' }}
              </Button>
            </div>
          </div>
          <div v-if="snapshot?.install?.output || snapshot?.install?.error" class="space-y-2 px-4 py-3">
            <div v-if="snapshot.install.error" class="text-xs text-destructive">{{ snapshot.install.error }}</div>
            <ScrollArea
              v-if="snapshot.install.output"
              horizontal
              class="max-h-40 rounded-sm bg-zinc-950"
              viewport-class="p-3"
            >
              <pre class="whitespace-pre text-xs leading-relaxed text-muted-foreground">{{ snapshot.install.output }}</pre>
            </ScrollArea>
          </div>
        </section>

        <section class="rounded-sm border border-border bg-card">
          <div class="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-foreground">Agent 设置</h2>
              <p class="mt-1 truncate text-xs text-muted-foreground">
                {{ snapshot?.settings.path ?? '~/.pi/agent/settings.json' }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <Button
                v-if="settingsDirty"
                variant="ghost"
                size="sm"
                class="h-8 rounded-sm text-xs text-muted-foreground"
                :disabled="isSavingModels || isSavingSettings || isInstallingPi || isLoading"
                @click="emit('resetSettings')"
              >
                <RotateCcw class="size-3.5" />
                还原
              </Button>
              <Button
                size="sm"
                class="h-8 rounded-sm text-xs"
                :disabled="!settingsDirty || isSavingModels || isSavingSettings || isInstallingPi || isLoading"
                @click="emit('saveSettings')"
              >
                <Save class="size-3.5" />
                {{ isSavingSettings ? '保存中' : '保存' }}
              </Button>
            </div>
          </div>
          <textarea
            :value="settingsDraft"
            class="min-h-[220px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
            spellcheck="false"
            placeholder="{ }"
            @input="emit('update:settingsDraft', ($event.target as HTMLTextAreaElement).value)"
          />
        </section>

        <section class="rounded-sm border border-border bg-card">
          <div class="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-foreground">模型配置</h2>
              <p class="mt-1 truncate text-xs text-muted-foreground">
                {{ snapshot?.models.path ?? '~/.pi/agent/models.json' }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <Button
                v-if="modelsDirty"
                variant="ghost"
                size="sm"
                class="h-8 rounded-sm text-xs text-muted-foreground"
                :disabled="isSavingModels || isSavingSettings || isInstallingPi || isLoading"
                @click="emit('resetModels')"
              >
                <RotateCcw class="size-3.5" />
                还原
              </Button>
              <Button
                size="sm"
                class="h-8 rounded-sm text-xs"
                :disabled="!modelsDirty || isSavingModels || isSavingSettings || isInstallingPi || isLoading"
                @click="emit('saveModels')"
              >
                <Save class="size-3.5" />
                {{ isSavingModels ? '保存中' : '保存' }}
              </Button>
            </div>
          </div>
          <textarea
            :value="modelsDraft"
            class="min-h-[320px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
            spellcheck="false"
            placeholder="{ }"
            @input="emit('update:modelsDraft', ($event.target as HTMLTextAreaElement).value)"
          />
        </section>

        <section class="rounded-sm border border-border bg-card">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-foreground">Skills</h2>
            <p class="mt-1 text-xs text-muted-foreground">当前 Pi 可用的本地 skills</p>
          </div>
          <div v-if="snapshot?.skills.length" class="divide-y divide-border">
            <div
              v-for="skill in snapshot.skills"
              :key="skill.path"
              class="group grid grid-cols-[minmax(140px,220px)_minmax(0,1fr)_32px] gap-4 px-4 py-3 text-xs"
            >
              <div class="truncate font-medium text-foreground" :title="skill.name">{{ skill.name }}</div>
              <div class="min-w-0">
                <div v-if="skill.description" class="truncate text-muted-foreground" :title="skill.description">
                  {{ skill.description }}
                </div>
                <div class="truncate font-mono text-muted-foreground/70" :title="skill.path">{{ skill.path }}</div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-7 justify-self-end rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                :title="`打开 ${skill.path}`"
                aria-label="打开 skill 文件夹"
                @click="emit('openSkillFolder', skill.path)"
              >
                <ExternalLink class="size-3.5" />
              </Button>
            </div>
          </div>
          <div v-else class="px-4 py-8 text-sm text-muted-foreground">未发现本地 skills</div>
        </section>
        </template>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
