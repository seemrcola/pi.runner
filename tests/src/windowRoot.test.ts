import { describe, expect, it } from 'vitest'
import { resolveWindowRoot } from '../../src/windowRoot'

describe('renderer window root', () => {
  it.each([
    ['', 'main'],
    ['?window=main', 'main'],
    ['?window=unknown', 'main'],
    ['?window=pet', 'pet'],
    ['?foo=bar&window=pet', 'pet'],
  ] as const)('resolves %s to %s', (search, expected) => {
    expect(resolveWindowRoot(search)).toBe(expected)
  })
})
