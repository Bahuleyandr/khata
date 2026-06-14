import { describe, it, expect, vi, afterEach } from 'vitest'
import { toDateInputValue } from './dates'

afterEach(() => vi.restoreAllMocks())

describe('toDateInputValue', () => {
  it('returns the LOCAL calendar day (not the UTC day) for an early-IST instant', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330) // IST = UTC+5:30
    // 02:00 IST on Apr 20 is 20:30Z on Apr 19; the date input must show Apr 20.
    expect(toDateInputValue('2026-04-19T20:30:00.000Z')).toBe('2026-04-20')
  })

  it('is stable for a noon-UTC timestamp in the UTC timezone', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)
    expect(toDateInputValue('2026-04-20T12:00:00.000Z')).toBe('2026-04-20')
  })
})
