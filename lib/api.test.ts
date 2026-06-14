// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMe } from './api'

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  } as Response
}

describe('apiFetch session-expiry handling', () => {
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { pathname: '/transactions', assign },
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('redirects to /login on a 401 (expired session) and still rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(401, { error: 'Unauthorized' })))

    await expect(getMe()).rejects.toThrow()
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('does NOT redirect on other errors (e.g. 400)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(400, { error: 'Bad request' })))

    await expect(getMe()).rejects.toThrow()
    expect(assign).not.toHaveBeenCalled()
  })
})
