// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPage from './page'
import { getMonthlyReview, type MonthlyReview } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({
  getMonthlyReview: vi.fn(),
  formatCents: (cents: string | number, currency = 'INR') => `${currency} ${(Number(cents) / 100).toFixed(2)}`,
  formatDate: (iso: string) => iso.slice(0, 10),
}))

const review: MonthlyReview = {
  period: {
    year: 2026,
    month: 4,
    label: 'April 2026',
    start: '2026-04-01',
    end: '2026-04-30',
    rangeKey: '2026-04',
    elapsedDays: 20,
    daysInMonth: 30,
  },
  overview: {
    transaction_count: 4,
    total_cents: '250000',
    uncategorized_count: 1,
    uncategorized_cents: '50000',
    needs_review_count: 2,
    receipts_needs_review_count: 1,
    missing_receipt_count: 1,
    duplicate_candidate_count: 2,
    open_task_count: 3,
  },
  tasks: [
    {
      id: 'uncategorized',
      label: 'Categorize transactions',
      detail: 'Assign categories before trusting totals and budgets.',
      count: 1,
      amount_cents: '50000',
      status: 'attention',
      href: '/transactions?start=2026-04-01&end=2026-04-30&uncategorized=true',
    },
    {
      id: 'receipts',
      label: 'Review receipt OCR',
      detail: 'Approve or correct receipt captures with raw OCR visible.',
      count: 1,
      status: 'attention',
      href: '/receipts?start=2026-04-01&end=2026-04-30&review_status=needs_review',
    },
    {
      id: 'export',
      label: 'Export monthly workbook',
      detail: 'Download the month once cleanup is done.',
      count: 4,
      status: 'ready',
      href: '/api/export/xlsx?year=2026&month=4',
    },
  ],
  budgets: [{
    id: 'budget-1',
    category_id: 'cat-food',
    category_name: 'Food',
    target_cents: 100000,
    period: 'monthly',
    spent_cents: 200000,
    pct: 200,
    projected_cents: 300000,
    variance_cents: 100000,
    projected_variance_cents: 200000,
  }],
  statements: {
    total: 1,
    failed: 0,
    pending: 0,
    parsed: 0,
    imported: 1,
    parsed_count: 4,
    imported_count: 4,
    duplicate_count: 0,
  },
  samples: [{
    id: 'expense-1',
    amount_cents: '50000',
    currency: 'INR',
    merchant: null,
    description: 'Cash lunch',
    category: 'Uncategorized',
    review_status: 'needs_review',
    occurred_at: '2026-04-20T10:00:00.000Z',
  }],
  narrative: 'April 2026 has 3 cleanup areas before close.',
}

describe('ReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMonthlyReview).mockResolvedValue(review)
  })

  it('renders the monthly checklist and action links', async () => {
    render(React.createElement(ReviewPage))

    expect(await screen.findByRole('heading', { name: 'Monthly Review' })).toBeTruthy()
    expect(screen.getByText('April 2026 has 3 cleanup areas before close.')).toBeTruthy()
    expect(screen.getByText('Categorize transactions').closest('a')?.getAttribute('href')).toBe(
      '/transactions?start=2026-04-01&end=2026-04-30&uncategorized=true',
    )
    expect(screen.getByText('Review receipt OCR').closest('a')?.getAttribute('href')).toBe(
      '/receipts?start=2026-04-01&end=2026-04-30&review_status=needs_review',
    )
    expect(screen.getByRole('link', { name: 'Export' }).getAttribute('href')).toBe('/api/export/xlsx?year=2026&month=4')

    await waitFor(() => expect(getMonthlyReview).toHaveBeenCalled())
  })
})
