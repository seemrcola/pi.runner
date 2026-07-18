import {
  PET_STATES,
  type PetDialogue,
  type PetDirector,
  type PetDirectorSnapshot,
  type PetState,
} from './petTypes'

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>
type IntervalRange = readonly [minimum: number, maximum: number]

type PetDirectorOptions = {
  clearTimeout?: (handle: TimeoutHandle) => void
  dialogue?: Partial<PetDialogue>
  dialogueIntervalMs?: IntervalRange
  initialState?: PetState
  lineDurationMs?: number
  random?: () => number
  setTimeout?: (callback: () => void, delay: number) => TimeoutHandle
  stateIntervalMs?: IntervalRange
}

export const DEFAULT_PET_DIALOGUE: PetDialogue = {
  coding: [
    '这段我盯着呢。',
    '再跑一次测试？',
    '键盘有点热了。',
    '先把类型收紧。',
  ],
  resting: [
    '先让脑子缓存一下。',
    '我只眯一小会儿。',
    '后台任务还在跑。',
    '伸个懒腰再继续。',
  ],
  thinking: [
    '这个边界值得再看一眼。',
    '让我理一下依赖。',
    '也许可以更简单。',
    '先确认真正的问题。',
  ],
  walking: [
    '出去转一圈。',
    '活动一下再回来。',
    '换个方向看看。',
    '这边的风景不错。',
  ],
}

export function createPetDirector(options: PetDirectorOptions = {}): PetDirector {
  const random = options.random ?? Math.random
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout
  const stateIntervalMs = options.stateIntervalMs ?? [8_000, 15_000]
  const dialogueIntervalMs = options.dialogueIntervalMs ?? [6_000, 12_000]
  const lineDurationMs = options.lineDurationMs ?? 4_000
  const dialogue = resolveDialogue(options.dialogue)
  const listeners = new Set<(snapshot: PetDirectorSnapshot) => void>()

  let started = false
  let stateTimer: TimeoutHandle | null = null
  let dialogueTimer: TimeoutHandle | null = null
  let lineTimer: TimeoutHandle | null = null
  let snapshot: PetDirectorSnapshot = {
    state: options.initialState ?? 'resting',
    line: '',
    lineVisible: false,
    stateRevision: 0,
    speechRevision: 0,
  }

  function notify() {
    const value = { ...snapshot }
    for (const listener of listeners) listener(value)
  }

  function clearTimer(timer: TimeoutHandle | null) {
    if (timer !== null) cancelTimeout(timer)
  }

  function randomDelay([minimum, maximum]: IntervalRange) {
    const unit = boundedRandom(random())
    return Math.round(minimum + (maximum - minimum) * unit)
  }

  function pickLine(state: PetState) {
    const candidates = dialogue[state]
    if (candidates.length === 1) return candidates[0]
    const withoutCurrent = candidates.filter((line) => line !== snapshot.line)
    return withoutCurrent[Math.floor(boundedRandom(random()) * withoutCurrent.length)] ?? candidates[0]
  }

  function hideLineLater() {
    clearTimer(lineTimer)
    lineTimer = scheduleTimeout(() => {
      lineTimer = null
      snapshot = { ...snapshot, lineVisible: false }
      notify()
    }, lineDurationMs)
  }

  function speak() {
    snapshot = {
      ...snapshot,
      line: pickLine(snapshot.state),
      lineVisible: true,
      speechRevision: snapshot.speechRevision + 1,
    }
    notify()
    hideLineLater()
  }

  function scheduleDialogue() {
    clearTimer(dialogueTimer)
    if (!started) return
    dialogueTimer = scheduleTimeout(() => {
      dialogueTimer = null
      speak()
      scheduleDialogue()
    }, randomDelay(dialogueIntervalMs))
  }

  function nextState() {
    const candidates = PET_STATES.filter((state) => state !== snapshot.state)
    return candidates[Math.floor(boundedRandom(random()) * candidates.length)] ?? candidates[0]
  }

  function setState(state: PetState) {
    if (snapshot.state === state) {
      speak()
      return
    }
    snapshot = {
      ...snapshot,
      state,
      stateRevision: snapshot.stateRevision + 1,
    }
    notify()
    speak()
    if (started) scheduleDialogue()
  }

  function scheduleState() {
    clearTimer(stateTimer)
    if (!started) return
    stateTimer = scheduleTimeout(() => {
      stateTimer = null
      setState(nextState())
      scheduleState()
    }, randomDelay(stateIntervalMs))
  }

  return {
    getSnapshot() {
      return { ...snapshot }
    },
    setState,
    speak,
    start() {
      if (started) return
      started = true
      speak()
      scheduleDialogue()
      scheduleState()
    },
    stop() {
      started = false
      clearTimer(stateTimer)
      clearTimer(dialogueTimer)
      clearTimer(lineTimer)
      stateTimer = null
      dialogueTimer = null
      lineTimer = null
    },
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...snapshot })
      return () => listeners.delete(listener)
    },
  }
}

function resolveDialogue(overrides: Partial<PetDialogue> | undefined): PetDialogue {
  return Object.fromEntries(PET_STATES.map((state) => {
    const lines = overrides?.[state]?.filter((line) => line.trim().length > 0)
    return [state, lines && lines.length > 0 ? [...lines] : DEFAULT_PET_DIALOGUE[state]]
  })) as PetDialogue
}

function boundedRandom(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 0.999_999
  return value
}
