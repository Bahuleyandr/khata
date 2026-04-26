import { describe, it, expect } from 'vitest'
import { greeting } from './greeting'

describe('greeting', () => {
  it('returns a greeting string', () => {
    expect(greeting('world')).toBe('Hello, world!')
  })
})
