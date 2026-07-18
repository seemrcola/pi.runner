import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPetDirector } from '../../src/features/desktop-pet/core/petDirector'

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop pet director', () => {
  it('starts with state dialogue and moves to a different state', () => {
    vi.useFakeTimers()
    const director = createPetDirector({
      initialState: 'resting',
      random: () => 0,
      stateIntervalMs: [100, 100],
      dialogueIntervalMs: [1_000, 1_000],
    })

    director.start()
    expect(director.getSnapshot()).toMatchObject({
      state: 'resting',
      line: '先让脑子缓存一下。',
      lineVisible: true,
    })

    vi.advanceTimersByTime(100)
    expect(director.getSnapshot()).toMatchObject({
      state: 'coding',
      line: '这段我盯着呢。',
    })
  })

  it('uses custom dialogue and falls back when an override is empty', () => {
    const director = createPetDirector({
      initialState: 'thinking',
      random: () => 0,
      dialogue: {
        thinking: ['自定义台词'],
        resting: [],
      },
    })

    director.speak()
    expect(director.getSnapshot().line).toBe('自定义台词')
    director.setState('resting')
    expect(director.getSnapshot().line).toBe('先让脑子缓存一下。')
    director.stop()
  })

  it('provides walking dialogue as a first-class state', () => {
    const director = createPetDirector({ random: () => 0 })

    director.setState('walking')

    expect(director.getSnapshot()).toMatchObject({
      state: 'walking',
      line: '出去转一圈。',
    })
    director.stop()
  })

  it('clears scheduled work when stopped', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const director = createPetDirector({
      random: () => 0,
      stateIntervalMs: [100, 100],
      dialogueIntervalMs: [100, 100],
    })
    director.subscribe(listener)
    director.start()
    const callsAfterStart = listener.mock.calls.length

    director.stop()
    vi.advanceTimersByTime(1_000)

    expect(listener).toHaveBeenCalledTimes(callsAfterStart)
  })
})
