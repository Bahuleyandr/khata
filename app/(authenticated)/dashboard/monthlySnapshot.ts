import type { CategoryTotal } from '../../../lib/api'

export interface MonthlySnapshot {
  monthLabel: string
  totalCents: number
  transactionCount: number
  categoryCount: number
  elapsedDays: number
  daysInMonth: number
  remainingDays: number
  progressPct: number
  averageDailyCents: number
  projectedMonthCents: number
  topCategory: {
    name: string
    totalCents: number
    sharePct: number
  } | null
  uncategorizedCount: number
}

function parseCents(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseCount(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildMonthlySnapshot(
  categories: CategoryTotal[],
  now = new Date(),
): MonthlySnapshot {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const elapsedDays = Math.max(1, Math.min(now.getDate(), daysInMonth))
  const remainingDays = Math.max(0, daysInMonth - elapsedDays)
  const totals = categories.map((category) => ({
    name: category.category,
    totalCents: parseCents(category.total_cents),
    count: parseCount(category.count),
  }))
  const totalCents = totals.reduce((sum, category) => sum + category.totalCents, 0)
  const transactionCount = totals.reduce((sum, category) => sum + category.count, 0)
  const categoryCount = totals.filter((category) => category.totalCents > 0).length
  const averageDailyCents = Math.round(totalCents / elapsedDays)
  const projectedMonthCents = Math.round((totalCents / elapsedDays) * daysInMonth)
  const top = [...totals].sort((a, b) => b.totalCents - a.totalCents)[0]
  const topCategory =
    top && top.totalCents > 0
      ? {
          name: top.name,
          totalCents: top.totalCents,
          sharePct: totalCents > 0 ? Math.round((top.totalCents / totalCents) * 100) : 0,
        }
      : null
  const uncategorizedCount =
    totals.find((category) => category.name.toLowerCase() === 'uncategorized')?.count ?? 0

  return {
    monthLabel: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    totalCents,
    transactionCount,
    categoryCount,
    elapsedDays,
    daysInMonth,
    remainingDays,
    progressPct: Math.round((elapsedDays / daysInMonth) * 100),
    averageDailyCents,
    projectedMonthCents,
    topCategory,
    uncategorizedCount,
  }
}
