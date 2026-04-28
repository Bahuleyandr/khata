import { describe, expect, it } from 'vitest'
import { buildMonthlySnapshot } from './monthlySnapshot'
import type { CategoryTotal } from '../../../lib/api'

function category(category: string, total_cents: string, count: string): CategoryTotal {
  return { category, total_cents, count, currency: 'INR' }
}

describe('buildMonthlySnapshot', () => {
  it('calculates month pace, projection, category share, and uncategorized count', () => {
    const snapshot = buildMonthlySnapshot(
      [
        category('Food', '90000', '3'),
        category('Travel', '30000', '2'),
        category('Uncategorized', '10000', '1'),
      ],
      new Date(2026, 3, 15, 12),
    )

    expect(snapshot.totalCents).toBe(130000)
    expect(snapshot.transactionCount).toBe(6)
    expect(snapshot.categoryCount).toBe(3)
    expect(snapshot.elapsedDays).toBe(15)
    expect(snapshot.daysInMonth).toBe(30)
    expect(snapshot.remainingDays).toBe(15)
    expect(snapshot.progressPct).toBe(50)
    expect(snapshot.averageDailyCents).toBe(8667)
    expect(snapshot.projectedMonthCents).toBe(260000)
    expect(snapshot.topCategory).toEqual({
      name: 'Food',
      totalCents: 90000,
      sharePct: 69,
    })
    expect(snapshot.uncategorizedCount).toBe(1)
  })

  it('stays useful for an empty month', () => {
    const snapshot = buildMonthlySnapshot([], new Date(2026, 1, 1, 8))

    expect(snapshot.totalCents).toBe(0)
    expect(snapshot.transactionCount).toBe(0)
    expect(snapshot.categoryCount).toBe(0)
    expect(snapshot.elapsedDays).toBe(1)
    expect(snapshot.daysInMonth).toBe(28)
    expect(snapshot.averageDailyCents).toBe(0)
    expect(snapshot.projectedMonthCents).toBe(0)
    expect(snapshot.topCategory).toBeNull()
    expect(snapshot.uncategorizedCount).toBe(0)
  })
})
