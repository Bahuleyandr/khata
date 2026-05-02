import type { BudgetVariance, DailyTotal, ExpenseSummary } from '../../../lib/api'

export interface ChartPoint {
  name: string
  value: number
  count: number
  href: string
}

export interface DailyChartPoint {
  date: string
  day: number
  value: number
  cumulative: number
  count: number
  href: string
}

export interface BudgetChartPoint {
  name: string
  spent: number
  remaining: number
  projected: number
  target: number
  pct: number
  status: 'over' | 'tight' | 'ok'
  href: string
}

export interface CaptureChartPoint {
  name: string
  value: number
  needsReview: number
  reviewed: number
  ignored: number
  count: number
  href: string
}

export interface DashboardChartModel {
  daily: DailyChartPoint[]
  categories: ChartPoint[]
  merchants: ChartPoint[]
  budgets: BudgetChartPoint[]
  capture: CaptureChartPoint[]
}

function cents(value: string | number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return Number.isFinite(parsed) ? parsed : 0
}

function rupees(value: string | number): number {
  return Math.round(cents(value) / 100)
}

function txHref(summary: ExpenseSummary, params: Record<string, string | number | boolean>) {
  const query = new URLSearchParams({
    start: summary.period.start,
    end: summary.period.end,
  })
  for (const [key, value] of Object.entries(params)) query.set(key, String(value))
  return `/transactions?${query.toString()}`
}

function dailyHref(summary: ExpenseSummary, point: DailyTotal) {
  return txHref(summary, { start: point.date, end: point.date })
}

function budgetStatus(budget: BudgetVariance): BudgetChartPoint['status'] {
  if (budget.projected_variance_cents > 0 || budget.pct >= 100) return 'over'
  if (budget.pct >= 80 || budget.projected_cents > budget.target_cents * 0.9) return 'tight'
  return 'ok'
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'telegram':
      return 'Telegram'
    case 'receipt':
      return 'Receipts'
    case 'statement':
      return 'Statements'
    case 'manual':
      return 'Manual'
    default:
      return source
  }
}

export function buildDashboardChartModel(summary: ExpenseSummary): DashboardChartModel {
  return {
    daily: summary.daily.map((point) => ({
      date: point.date,
      day: point.day,
      value: rupees(point.total_cents),
      cumulative: rupees(point.cumulative_cents),
      count: point.count,
      href: dailyHref(summary, point),
    })),
    categories: summary.mtd.slice(0, 8).map((category) => ({
      name: category.category,
      value: rupees(category.total_cents),
      count: Number.parseInt(category.count, 10) || 0,
      href: txHref(summary, { category: category.category }),
    })),
    merchants: summary.merchants.top.slice(0, 8).map((merchant) => ({
      name: merchant.name,
      value: rupees(merchant.total_cents),
      count: merchant.count,
      href: txHref(summary, { merchant: merchant.name }),
    })),
    budgets: summary.budgets.slice(0, 8).map((budget) => {
      const spent = rupees(budget.spent_cents)
      const target = Math.max(rupees(budget.target_cents), 0)
      return {
        name: budget.category_name,
        spent,
        remaining: Math.max(target - spent, 0),
        projected: rupees(budget.projected_cents),
        target,
        pct: budget.pct,
        status: budgetStatus(budget),
        href: txHref(summary, { category: budget.category_name }),
      }
    }),
    capture: summary.sources.map((source) => ({
      name: sourceLabel(source.source),
      value: rupees(source.total_cents),
      needsReview: source.needs_review_count,
      reviewed: source.reviewed_count,
      ignored: source.ignored_count,
      count: source.count,
      href: txHref(summary, { source: source.source }),
    })),
  }
}

