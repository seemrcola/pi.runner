import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('architecture boundaries', () => {
  it('keeps backend code independent from the renderer src tree', () => {
    const backendFiles = sourceFiles('backend')

    for (const file of backendFiles) {
      expect(source(file), file).not.toMatch(/from ['"](?:\.\.\/)+src\//)
    }
  })

  it('keeps App.vue from owning backend protocol event reduction', () => {
    const app = source('src/App.vue')

    expect(app).toContain("import { useAppSessionShell } from '@/composables/useAppSessionShell'")
    expect(app).not.toContain('function handleBackendMessage')
    expect(app).not.toContain('switch (message.type)')
  })

  it('keeps App.vue as a layout shell instead of the application state container', () => {
    const app = source('src/App.vue')

    expect(app).toContain("import { useAppSessionShell } from '@/composables/useAppSessionShell'")
    expect(app).not.toContain("from '@/composables/useBackendEvents'")
    expect(app).not.toContain("from '@/composables/useConversationLifecycle'")
    expect(app).not.toContain("from '@/composables/useConversationMessages'")
    expect(app).not.toContain("from '@/lib/backendSocket'")
    expect(app).not.toContain("from '@/lib/conversationRuntime'")
    expect(app).not.toContain('const conversations = ref')
    expect(app).not.toContain('const runnerSnapshots = ref')
    expect(app).not.toContain('function connectBackend')
  })

  it('derives backend protocol types from the websocket schema', () => {
    const protocol = source('shared/protocol.ts')

    expect(protocol).toContain('export type BackendMessage = z.infer<typeof backendMessageSchema>')
    expect(protocol).not.toContain("| { type: 'backend:ready'")
    expect(protocol).not.toContain("| { type: 'pi:text_delta'")
  })

  it('keeps shared domain types independent from the transport protocol', () => {
    const chat = source('shared/chat.ts')

    expect(chat).not.toContain("from './protocol.js'")
  })

  it('keeps the Button component independent from its public barrel', () => {
    const button = source('src/components/ui/button/Button.vue')
    const variants = source('src/components/ui/button/variants.ts')

    expect(button).toContain("from './variants'")
    expect(button).not.toContain("from '.'")
    expect(variants).toContain('export const buttonVariants')
  })

  it('keeps backend event transport separate from event side effects', () => {
    const server = source('backend/server.ts')
    const runtime = source('backend/runtime/createBackendRuntime.ts')
    const subscribers = source('backend/events/subscribers.ts')

    expect(server).toContain("from './runtime/createBackendRuntime.js'")
    expect(runtime).toContain("from '../events/bus.js'")
    expect(runtime).toContain("from '../events/subscribers.js'")
    expect(runtime).toContain('createBackendEventBus')
    expect(runtime).toContain('createAgentEndSessionSyncSubscriber')
    const eventPipeline = runtime.slice(
      runtime.indexOf('const backendEvents = createBackendEventBus'),
      runtime.indexOf('emitBackendEvent = (payload)'),
    )
    expectTextBefore(eventPipeline, 'createAgentEndSessionSyncSubscriber', 'options.transportSubscriber')
    expect(server).not.toContain('syncSessionAfterAgentEnd(payload')
    expect(subscribers).toContain('export function createAgentEndSessionSyncSubscriber')
  })

  it('keeps the public backend event pipeline typed at the protocol boundary', () => {
    const bus = source('backend/events/bus.ts')
    const dispatcher = source('backend/client/clientMessageDispatcher.ts')
    const lifecycle = source('backend/client/conversationLifecycle.ts')
    const processRunner = source('backend/pi/processRunner.ts')
    const rpcEvents = source('backend/pi/rpcEvents.ts')

    expect(bus).toContain("import type { BackendMessage } from '../../shared/protocol.js'")
    expect(bus).not.toContain('BackendEvent = Record<string, unknown>')
    expect(dispatcher).toContain('payload: BackendMessage')
    expect(lifecycle).toContain('payload: BackendMessage')
    expect(processRunner).toContain('PiRpcEvent')
    expect(rpcEvents).toContain('export type PiRpcEvent')
  })

  it('builds backend runtime dependencies without temporal runner coupling', () => {
    const server = source('backend/server.ts')
    const runtime = source('backend/runtime/createBackendRuntime.ts')

    expect(server).toContain("from './runtime/createBackendRuntime.js'")
    expect(server).not.toContain('let piRunners')
    expect(runtime).toContain('export function createBackendRuntime')
    expectTextBefore(runtime, 'const piRunners = createPiProcessManager', 'const backendEvents = createBackendEventBus')
  })

  it('keeps Pi process management behind the backend/pi facade', () => {
    const runtime = source('backend/runtime/createBackendRuntime.ts')
    const clientHandlers = source('backend/client/clientMessageDispatcher.ts')
    const lifecycle = source('backend/client/conversationLifecycle.ts')
    const subscribers = source('backend/events/subscribers.ts')
    const sessionSync = source('backend/events/agentEndSessionSync.ts')
    const piFacade = source('backend/pi/index.ts')

    expect(runtime).toContain("from '../pi/index.js'")
    expect(runtime).not.toContain("from './pi/runnerManager.js'")
    expect(subscribers).toContain("from '../pi/index.js'")
    expect(sessionSync).toContain("from '../pi/index.js'")
    expect(piFacade).toContain('createPiProcessManager')
    expect(piFacade).toContain('PiProcessManagementApi')

    expect(clientHandlers).not.toContain('getExisting')
    expect(clientHandlers).not.toContain('writePrompt')
    expect(lifecycle).not.toContain('writePrompt')
    expect(lifecycle).not.toContain('deps.piRunners.get(')
  })

  it('keeps session lease ownership out of the runner manager state table', () => {
    const runnerManager = source('backend/pi/runnerManager.ts')
    const leaseRegistry = source('backend/pi/sessionLeaseRegistry.ts')

    expect(runnerManager).toContain("from './sessionLeaseRegistry.js'")
    expect(runnerManager).toContain('new SessionLeaseRegistry')
    expect(runnerManager).not.toContain('sessionOwners = new Map')
    expect(leaseRegistry).toContain('export class SessionLeaseRegistry')
  })

  it('keeps conversation lifecycle split by user intent', () => {
    const lifecycle = source('src/composables/useConversationLifecycle.ts')

    expect(lifecycle).toContain("from './conversationLifecycle/creation'")
    expect(lifecycle).toContain("from './conversationLifecycle/promptFlow'")
    expect(lifecycle).toContain("from './conversationLifecycle/visibilityActions'")
    expect(source('src/composables/conversationLifecycle/creation.ts')).toContain('export function createConversationCreationActions')
    expect(source('src/composables/conversationLifecycle/promptFlow.ts')).toContain('export function createPromptFlowActions')
    expect(source('src/composables/conversationLifecycle/visibilityActions.ts')).toContain('export function createVisibilityActions')
  })

  it('keeps workspace view state in a dedicated renderer composable', () => {
    const shell = source('src/composables/useAppSessionShell.ts')
    const workspaceViewState = source('src/composables/useWorkspaceViewState.ts')

    expect(shell).toContain("from '@/composables/useWorkspaceViewState'")
    expect(shell).not.toContain('function updateWorkspaceViewState')
    expect(workspaceViewState).toContain('export function useWorkspaceViewState')
  })

  it('delegates backend workspace view state events out of the main reducer switch', () => {
    const backendEvents = source('src/composables/useBackendEvents.ts')
    const workspaceEvents = source('src/composables/backendEvents/workspaceViewEvents.ts')

    expect(backendEvents).toContain("from '@/composables/backendEvents/workspaceViewEvents'")
    expect(backendEvents).toContain('handleWorkspaceViewStateMessage')
    expect(workspaceEvents).toContain('export function handleWorkspaceViewStateMessage')
  })

  it('delegates backend runner snapshot events out of the main reducer switch', () => {
    const backendEvents = source('src/composables/useBackendEvents.ts')
    const runnerEvents = source('src/composables/backendEvents/runnerEvents.ts')

    expect(backendEvents).toContain("from '@/composables/backendEvents/runnerEvents'")
    expect(backendEvents).toContain('handleRunnerStateMessage')
    expect(backendEvents).not.toContain("case 'runner:list'")
    expect(backendEvents).not.toContain("case 'runner:snapshot'")
    expect(runnerEvents).toContain('export function handleRunnerStateMessage')
  })

  it('keeps session jsonl parsing separate from sqlite index storage', () => {
    expect(source('backend/sessions/sessionIndexSync.ts')).toContain("from './sessionJsonlParser.js'")
    expect(source('backend/sessions/sessionIndexStore.ts')).not.toContain('function readParsedSession')
    expect(source('backend/sessions/sessionIndexStore.ts')).not.toContain("from './sessionJsonlParser.js'")
    expect(source('backend/sessions/sessionJsonlParser.ts')).toContain('export function readParsedSession')
  })

  it('uses one turn grouping implementation for parsing and projection', () => {
    const parser = source('backend/sessions/sessionJsonlParser.ts')

    expect(parser).toContain("from './turnGrouping.js'")
    expect(parser).not.toContain('function buildAgentTurns')
  })

  it('keeps local source imports acyclic', () => {
    expect(findLocalImportCycles()).toEqual([])
  })

  it('keeps the reusable desktop pet core and components independent from Electron and app runtime', () => {
    const portablePetFiles = [
      ...sourceFiles('src/features/desktop-pet/core'),
      ...sourceFiles('src/features/desktop-pet/components'),
    ]

    for (const file of portablePetFiles) {
      const text = source(file)
      expect(text, file).not.toContain("from 'electron'")
      expect(text, file).not.toContain('window.piDesktop')
      expect(text, file).not.toContain('window.piPet')
      expect(text, file).not.toContain("from '@/composables")
      expect(text, file).not.toContain("from '@shared/")
    }
  })

  it('keeps session index schema, sync, projection, and turn grouping in separate modules', () => {
    const store = source('backend/sessions/sessionIndexStore.ts')

    expect(store).toContain("from './sessionIndexSchema.js'")
    expect(store).toContain("from './sessionIndexSync.js'")
    expect(store).toContain("from './sessionProjection.js'")
    expect(store).not.toContain("from './turnGrouping.js'")
    expect(store).not.toContain('function ensureColumn')
    expect(store).not.toContain('function listSessionFiles')
    expect(store).not.toContain('function buildAgentTurns')
    expect(source('backend/sessions/sessionIndexSchema.ts')).toContain('export function ensureSessionIndexSchema')
    expect(source('backend/sessions/sessionIndexSync.ts')).toContain('export function syncSessionIndex')
    expect(source('backend/sessions/sessionProjection.ts')).toContain("from './turnGrouping.js'")
    expect(source('backend/sessions/sessionProjection.ts')).toContain('export function createConversationProjector')
    expect(source('backend/sessions/turnGrouping.ts')).toContain('export function buildAgentTurns')
  })

  it('persists workspace view preferences separately from logical hidden workspaces', () => {
    const schema = source('backend/sessions/sessionIndexSchema.ts')

    expect(schema).toContain('create table if not exists workspace_view_states')
    expect(schema).toContain('workspace_path text primary key')
    expect(schema).toContain('is_pinned integer not null default 0')
    expect(schema).toContain('is_collapsed integer not null default 0')
    expect(schema).toContain('pinned_at real')
    expect(schema).toContain('updated_at real not null')
    expect(schema).toContain('create table if not exists hidden_workspaces')
  })

  it('uses DESIGN.md as the single design document reference', () => {
    const readme = source('README.md')

    expect(readme).toContain('[DESIGN.md](./DESIGN.md)')
    expect(readme).not.toContain('[design.md](./design.md)')
  })
})

function expectTextBefore(sourceText: string, before: string, after: string) {
  const beforeIndex = sourceText.indexOf(before)
  const afterIndex = sourceText.indexOf(after)
  expect(beforeIndex, `${before} should exist`).toBeGreaterThanOrEqual(0)
  expect(afterIndex, `${after} should exist`).toBeGreaterThanOrEqual(0)
  expect(beforeIndex).toBeLessThan(afterIndex)
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

function findLocalImportCycles(): string[][] {
  const files = ['backend', 'electron', 'shared', 'src'].flatMap(sourceFiles)
  const absoluteFiles = new Set(files.map((file) => resolve(root, file)))
  const graph = new Map<string, string[]>()

  for (const file of absoluteFiles) {
    const dependencies: string[] = []
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const dependency = resolveLocalImport(file, match[1], absoluteFiles)
      if (dependency) dependencies.push(dependency)
    }
    graph.set(file, dependencies)
  }

  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  function visit(file: string): void {
    const cycleStart = stack.indexOf(file)
    if (cycleStart >= 0) {
      cycles.push([...stack.slice(cycleStart), file].map((item) => item.slice(root.length + 1)))
      return
    }
    if (visited.has(file)) return
    stack.push(file)
    for (const dependency of graph.get(file) ?? []) visit(dependency)
    stack.pop()
    visited.add(file)
  }

  for (const file of graph.keys()) visit(file)
  return cycles
}

function resolveLocalImport(importer: string, specifier: string, files: Set<string>): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = resolve(root, 'src', specifier.slice(2))
  else if (specifier.startsWith('@shared/')) base = resolve(root, 'shared', specifier.slice(8))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  const normalized = base.replace(/\.js$/, '')
  return [normalized, `${normalized}.ts`, `${normalized}.vue`, join(normalized, 'index.ts')]
    .find((candidate) => files.has(candidate)) ?? null
}
