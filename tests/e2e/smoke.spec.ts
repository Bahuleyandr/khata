import { expect, test, type Page } from '@playwright/test'

const expense = {
  id: '11111111-1111-4111-8111-111111111111',
  amount_cents: '125000',
  currency: 'INR',
  description: 'Lunch with team',
  merchant: 'OpenAI Cafe',
  category_id: '33333333-3333-4333-8333-333333333333',
  category: 'Food',
  source: 'receipt',
  occurred_at: '2026-04-20T10:00:00.000Z',
  image_key: 'receipts/openai.jpg',
  review_status: 'needs_review',
  tags: ['team'],
}

async function mockApi(page: Page) {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        telegram_user_id: 42,
        ledger_user_id: 42,
        personal_ledger_id: 42,
        first_name: 'Ada',
        role: 'owner',
        is_owner: true,
        selected_ledger_id: 42,
        selected_ledger_name: 'Personal',
        selected_ledger_kind: 'personal',
        can_view: true,
        can_add: true,
        can_manage: true,
      },
    }),
  )
  await page.route('**/api/ledgers', (route) =>
    route.fulfill({
      json: {
        selected_ledger_id: 42,
        ledgers: [
          {
            id: 42,
            name: 'Personal',
            kind: 'personal',
            owner_telegram_user_id: 42,
            role: 'owner',
            can_view: true,
            can_add: true,
            can_manage: true,
          },
          {
            id: -42,
            name: 'Household',
            kind: 'household',
            owner_telegram_user_id: 42,
            role: 'owner',
            can_view: true,
            can_add: true,
            can_manage: true,
          },
        ],
      },
    }),
  )
  await page.route('**/api/access/users**', (route) => {
    const member = {
      telegram_user_id: 99,
      first_name: 'Grace',
      username: 'grace',
      role: 'member',
      status: 'active',
      ledger_id: 42,
      ledger_name: 'Personal',
      ledger_kind: 'personal',
      ledger_user_id: 42,
      invited_by: 42,
      can_view: true,
      can_add: true,
      can_manage: false,
      created_at: '2026-04-28T10:00:00.000Z',
      updated_at: '2026-04-28T10:00:00.000Z',
      last_login_at: null,
      revoked_at: null,
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          users: [{
            telegram_user_id: 42,
            first_name: 'Ada',
            username: 'ada',
            role: 'owner',
            status: 'active',
            ledger_id: 42,
            ledger_name: 'Personal',
            ledger_kind: 'personal',
            ledger_user_id: 42,
            invited_by: null,
            can_view: true,
            can_add: true,
            can_manage: true,
            created_at: '2026-04-28T10:00:00.000Z',
            updated_at: '2026-04-28T10:00:00.000Z',
            last_login_at: '2026-04-28T10:00:00.000Z',
            revoked_at: null,
          }, member],
        },
      })
    }
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: member })
  })
  await page.route('**/api/insights', (route) => route.fulfill({ json: { insights: [] } }))
  await page.route('**/api/categories', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Food', is_default: true }],
      })
    }
    return route.fulfill({ status: 201, json: { id: '44444444-4444-4444-8444-444444444444', name: 'Travel', is_default: false } })
  })
  await page.route('**/api/budgets**', (route) =>
    route.fulfill({
      json: {
        month: '2026-04',
        budgets: [{
          id: 'budget-1',
          category_id: '33333333-3333-4333-8333-333333333333',
          category_name: 'Food',
          target_cents: 200000,
          period: 'monthly',
          spent_cents: 125000,
          pct: 63,
          projected_cents: 250000,
          variance_cents: -75000,
          projected_variance_cents: 50000,
        }],
      },
    }),
  )
  await page.route('**/api/tags', (route) => route.fulfill({ json: { tags: [{ id: 'tag-1', name: 'team', count: 1 }] } }))
  await page.route('**/api/statements/*/rows', (route) =>
    route.fulfill({
      json: {
        rows: [{
          id: '66666666-6666-4666-8666-666666666666',
          statement_id: '55555555-5555-4555-8555-555555555555',
          row_index: 0,
          occurred_at: '2026-04-20',
          description: 'Metro card',
          amount_cents: '7500',
          currency: 'INR',
          suggested_category: 'Food',
          category_id: '33333333-3333-4333-8333-333333333333',
          category: 'Food',
          tag_names: ['commute'],
          already_logged: false,
          matched_expense_id: null,
          status: 'pending',
          imported_expense_id: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/statements', (route) =>
    route.fulfill({
      json: {
        statements: [{
          id: '55555555-5555-4555-8555-555555555555',
          file_key: 'statements/42/statement.pdf',
          mime_type: 'application/pdf',
          status: 'parsed',
          parsed_count: 1,
          imported_count: 0,
          duplicate_count: 0,
          error_reason: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/subscriptions**', (route) =>
    route.fulfill({
      json: {
        subscriptions: [{
          name: 'MiniMax',
          merchant_key: 'minimax',
          count: 3,
          total_cents: '149700',
          first_seen: '2026-02-01',
          last_seen: '2026-04-01',
          cadence: 'monthly',
          confidence: 100,
          avg_amount_cents: '49900',
          monthly_estimate_cents: '49900',
          avg_interval_days: 30,
          interval_jitter_days: 1.5,
          amount_variance_pct: 0,
          charge_dates: ['2026-02-01', '2026-03-01', '2026-04-01'],
          next_expected_at: '2026-05-01',
          days_until_next: 2,
          is_overdue: false,
          not_seen_this_month: false,
          preference_status: null,
        }],
      },
    }),
  )
  await page.route('**/api/audit-log**', (route) =>
    route.fulfill({
      json: {
        events: [{
          id: 'audit-1',
          actor_user_id: '42',
          action: 'expense.update',
          entity_type: 'expense',
          entity_id: expense.id,
          before: null,
          after: { id: expense.id },
          metadata: {},
          created_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  const summary = {
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
    mtd: [{ category: 'Food', total_cents: '125000', currency: 'INR', count: '1' }],
    recent: [expense],
    daily: [
      { date: '2026-04-01', day: 1, total_cents: '0', count: 0, cumulative_cents: '0' },
      { date: '2026-04-20', day: 20, total_cents: '125000', count: 1, cumulative_cents: '125000' },
      { date: '2026-04-30', day: 30, total_cents: '0', count: 0, cumulative_cents: '125000' },
    ],
    sources: [{
      source: 'receipt',
      total_cents: '125000',
      count: 1,
      needs_review_count: 1,
      reviewed_count: 0,
      ignored_count: 0,
    }],
    budgets: [{
      id: 'budget-1',
      category_id: '33333333-3333-4333-8333-333333333333',
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
      top: [{ name: 'OpenAI Cafe', total_cents: '125000', count: 1 }],
      new: [{ name: 'OpenAI Cafe', total_cents: '125000', count: 1 }],
      spikes: [],
    },
    subscriptions: [{
      name: 'MiniMax',
      merchant_key: 'minimax',
      count: 3,
      total_cents: '149700',
      first_seen: '2026-02-01',
      last_seen: '2026-04-01',
      cadence: 'monthly',
      confidence: 100,
      avg_amount_cents: '49900',
      monthly_estimate_cents: '49900',
      avg_interval_days: 30,
      interval_jitter_days: 1.5,
      amount_variance_pct: 0,
      charge_dates: ['2026-02-01', '2026-03-01', '2026-04-01'],
      next_expected_at: '2026-05-01',
      days_until_next: 2,
      is_overdue: false,
      not_seen_this_month: false,
      preference_status: null,
    }],
    narrative: 'April 2026: ₹1,250 across 1 transaction. Top category is Food.',
  }
  await page.route('**/api/review/monthly**', (route) =>
    route.fulfill({
      json: {
        period: summary.period,
        overview: {
          transaction_count: 1,
          total_cents: '125000',
          uncategorized_count: 0,
          uncategorized_cents: '0',
          needs_review_count: 1,
          receipts_needs_review_count: 1,
          missing_receipt_count: 0,
          duplicate_candidate_count: 0,
          open_task_count: 1,
        },
        tasks: [
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
            count: 1,
            status: 'ready',
            href: '/api/export/xlsx?year=2026&month=4',
          },
        ],
        budgets: summary.budgets,
        statements: {
          total: 0,
          failed: 0,
          pending: 0,
          parsed: 0,
          imported: 0,
          parsed_count: 0,
          imported_count: 0,
          duplicate_count: 0,
        },
        samples: [expense],
        narrative: 'April 2026 has 1 cleanup area before close.',
      },
    }),
  )
  await page.route('**/api/expenses/**', (route) => {
    const url = route.request().url()
    if (url.includes('/summary') || url.includes('/duplicates')) {
      return route.fallback()
    }
    return route.fulfill({ json: expense })
  })
  await page.route('**/api/expenses/summary**', (route) =>
    route.fulfill({ json: summary }),
  )
  await page.route('**/api/expenses?**', (route) =>
    route.fulfill({ json: { data: [expense], total: 1, page: 1, totalPages: 1 } }),
  )
  await page.route('**/api/expenses/*/duplicates', (route) => route.fulfill({ json: { candidates: [] } }))
  await page.route('**/api/receipts?**', (route) =>
    route.fulfill({
      json: {
        data: [{
          ...expense,
          receipt_url: '/api/receipts/11111111-1111-4111-8111-111111111111/image',
          raw_text: 'OpenAI Cafe total 1250',
        }],
        total: 1,
        page: 1,
        totalPages: 1,
      },
    }),
  )
  await page.route('**/api/receipts/*/image', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="white"/><text x="20" y="40">Receipt</text></svg>',
    }),
  )
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('login and dashboard shell render', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Khata' })).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText(/Top category is Food/)).toBeVisible()
  await expect(page.getByText('Daily Trend')).toBeVisible()
  await expect(page.getByText('Category Split')).toBeVisible()
  await expect(page.getByText('Top Merchants')).toBeVisible()
  await expect(page.getByText('Capture Mix')).toBeVisible()
  await expect(page.getByText('Budget Pace')).toBeVisible()
  await expect(page.getByText('Subscription Watch')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible()
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('monthly review checklist renders action links', async ({ page }) => {
  await page.goto('/review')
  await expect(page.getByRole('heading', { name: 'Monthly Review' })).toBeVisible()
  await expect(page.getByText('Close Checklist')).toBeVisible()
  await expect(page.getByText('Review receipt OCR')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Export', exact: true })).toHaveAttribute('href', /\/api\/export\/xlsx/)
})

test('transactions and receipt review flows render', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page.getByText('OpenAI Cafe')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download Excel' })).toHaveAttribute('href', /\/api\/export\/xlsx/)
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Transaction' })).toBeVisible()

  await page.goto('/receipts')
  await page.getByRole('button', { name: /OpenAI Cafe/ }).click()
  await expect(page.getByRole('dialog', { name: 'Review Receipt' })).toBeVisible()
  await page.locator('details.raw-text-panel').evaluate((node) => node.setAttribute('open', ''))
  await expect(page.getByText('OpenAI Cafe total 1250')).toBeVisible()
})

test('manage workspace renders categories, budgets, tags, and statements', async ({ page }) => {
  await page.goto('/manage')
  await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible()
  await expect(page.getByText('Categories')).toBeVisible()
  await expect(page.getByText('Ledger Access')).toBeVisible()
  await expect(page.getByLabel('Telegram user ID')).toBeVisible()
  await expect(page.getByText(/99 · @grace/)).toBeVisible()
  await expect(page.getByText('Budgets')).toBeVisible()
  await expect(page.getByText('#team')).toBeVisible()
  await expect(page.getByText('MiniMax')).toBeVisible()
  await expect(page.getByLabel('Statement file')).toBeVisible()
  await page.getByRole('button', { name: 'Review' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Import Review')).toBeVisible()
  await expect(page.getByLabel('Bulk statement category')).toBeVisible()
  await expect(page.getByLabel('Tags for Metro card')).toHaveValue('commute')
  await expect(page.getByText('expense update')).toBeVisible()
})
