import { describe, expect, it } from 'vitest'
import { getTokenFromRequestUrl, isAuthorizedRequest } from '../../../backend/transport/auth.js'

describe('websocket auth', () => {
  it('accepts requests with the configured token in the query string', () => {
    expect(isAuthorizedRequest('/?token=secret', 'secret')).toBe(true)
  })

  it('rejects missing or incorrect tokens when auth is configured', () => {
    expect(isAuthorizedRequest('/', 'secret')).toBe(false)
    expect(isAuthorizedRequest('/?token=wrong', 'secret')).toBe(false)
  })

  it('allows requests when no backend token is configured', () => {
    expect(isAuthorizedRequest('/', '')).toBe(true)
    expect(isAuthorizedRequest('/', undefined)).toBe(true)
  })

  it('extracts tokens from relative websocket urls', () => {
    expect(getTokenFromRequestUrl('/chat?token=abc')).toBe('abc')
  })
})
