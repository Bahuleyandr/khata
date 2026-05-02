import { describe, expect, it } from 'vitest'
import { buildDashboardChartModel } from './chartData'
import type { ExpenseSummary } from '../../../lib/api'

const summary: ExpenseSummary = {
  period: {
    year: 2026,
    month: 4,
    label: 'April 2026',
    start: '2026-04-01',
    end: '2026-04-30',
    rangeKey: '2026-04',
    elapsedDays: 15,
    daysInMonth: 30,
  },
  mtd: [
    { category: 'Food', total_cents: '125000', currency: 'INR', count: '3' },
    { category: 'Travel', total_cents: '75000', currency: 'INR', count: '2' },
  ],
  recent: [],
  daily: [
    { date: '2026-04-01', day: 1, total_cents: '50000', count: 1, cumulative_cents: '50000' },
    { date: '2026-04-02', day: 2, total_cents: '0', count: 0, cumulative_cents: '50000' },
    { date: '2026-04-03', day: 3, total_cents: '150000', count: 4, cumulative_cents: '200000' },
  ],
  sources: [
    {
      source: 'receipt',
      total_cents: '125000',
      count: 2,
      needs_review_count: 1,
      reviewed_count: 1,
      ignored_count: 0,
    },
    {
      source: 'telegram',
      total_cents: '75000',
      count: 3,
      needs_review_count: 0,
      reviewed_count: 3,
      ignored_count: 0,
    },
  ],
  budgets: [{
    id: 'budget-1',
    category_id: 'category-1',
    category_name: 'Food',
    target_cents: 200000,
    period: 'monthly',
    spent_cents: 125000,
    pct: 63,
    projected_cents: 250000,
    variance_cents: -75000,
    projected_variance_cents: 50000,
  }],
  merchants: {
    top: [{ name: 'OpenAI Cafe', total_cents: '125000', count: 2 }],
    new: [],
    spikes: [],
  },
  subscriptions: [],
  narrative: 'April 2026: ₹2,000 across 5 transactions.',
}

describe('buildDashboardChartModel', () => {
  it('builds rupee-valued chart points with transaction drill-down URLs', () => {
    const model = buildDashboardChartModel(summary)

    expect(model.daily).toEqual([
      {
        date: '2026-04-01',
        day: 1,
        value: 500,
        cumulative: 500,
        count: 1,
        href: '/transactions?start=2026-04-01&end=2026-04-01',
      },
      {
        date: '2026-04-02',
        day: 2,
        value: 0,
        cumulative: 500,
        count: 0,
        href: '/transactions?start=2026-04-02&end=2026-04-02',
      },
      {
        date: '2026-04-03',
        day: 3,
        value: 1500,
        cumulative: 2000,
        count: 4,
        href: '/transactions?start=2026-04-03&end=2026-04-03',
      },
    ])
    expect(model.categories[0]).toMatchObject({
      name: 'Food',
      value: 1250,
      count: 3,
      href: '/transactions?start=2026-04-01&end=2026-04-30&category=Food',
    })
    expect(model.merchants[0]).toMatchObject({
      name: 'OpenAI Cafe',
      value: 1250,
      count: 2,
      href: '/transactions?start=2026-04-01&end=2026-04-30&merchant=OpenAI+Cafe',
    })
  })

  it('builds budget and capture health chart points', () => {
    const model = buildDashboardChartModel(summary)

    expect(model.budgets[0]).toEqual({
      name: 'Food',
      spent: 1250,
      remaining: 750,
      projected: 2500,
      target: 2000,
      pct: 63,
      status: 'over',
      href: '/transactions?start=2026-04-01&end=2026-04-30&category=Food',
    })
    expect(model.capture).toEqual([
      {
        name: 'Receipts',
        value: 1250,
        count: 2,
        needsReview: 1,
        reviewed: 1,
        ignored: 0,
        href: '/transactions?start=2026-04-01&end=2026-04-30&source=receipt',
      },
      {
        name: 'Telegram',
        value: 750,
        count: 3,
        needsReview: 0,
        reviewed: 3,
        ignored: 0,
        href: '/transactions?start=2026-04-01&end=2026-04-30&source=telegram',
      },
    ])
  })
})

