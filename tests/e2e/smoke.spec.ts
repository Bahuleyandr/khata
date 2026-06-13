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
  confidence: {
    overall: 78,
    amount: 100,
    date: 95,
    merchant: 95,
    category: 86,
    account: 55,
    source: 74,
    reasons: ['account_unmatched'],
  },
  paid_by_user_id: '42',
  settlement_scope: 'personal',
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
  await page.route('**/api/accounts**', (route) =>
    route.fulfill({
      json: {
        accounts: [{
          id: '77777777-7777-4777-8777-777777777777',
          user_id: 42,
          name: 'AmEx Platinum',
          type: 'card',
          institution: 'American Express',
          last_four: '31009',
          is_default: true,
          archived_at: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/alerts**', (route) =>
    route.fulfill({
      json: {
        alerts: [{
          id: 'alert-1',
          user_id: 42,
          severity: 'warning',
          kind: 'reconciliation_gap',
          title: 'Statement gaps need review',
          detail: '1 statement row is not reconciled.',
          href: '/manage',
          dedupe_key: 'gap-2026-04',
          dismissed_at: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/captures/summary', (route) =>
    route.fulfill({
      json: {
        failures: [{
          failure_kind: 'not_receipt',
          count: 2,
          latest_error: 'Receipt parser found no expense',
          latest_at: '2026-04-28T10:00:00.000Z',
        }],
        statuses: [
          { key: 'failed', count: 2 },
          { key: 'processed', count: 10 },
        ],
        sources: [
          { key: 'telegram_text', count: 8 },
          { key: 'telegram_photo', count: 4 },
        ],
      },
    }),
  )
  await page.route('**/api/captures**', (route) => {
    if (route.request().url().includes('/api/captures/summary')) {
      return route.fulfill({
        json: {
          failures: [{
            failure_kind: 'not_receipt',
            count: 2,
            latest_error: 'Receipt parser found no expense',
            latest_at: '2026-04-28T10:00:00.000Z',
          }],
          statuses: [
            { key: 'failed', count: 2 },
            { key: 'processed', count: 10 },
          ],
          sources: [
            { key: 'telegram_text', count: 8 },
            { key: 'telegram_photo', count: 4 },
          ],
        },
      })
    }
    return route.fulfill({
      json: {
        captures: [{
          id: 'capture-1',
          user_id: 42,
          source: 'telegram_text',
          status: 'failed',
          telegram_message_id: 10,
          file_key: null,
          file_unique_id: null,
          content_hash: null,
          raw_text: 'Alert: INR 301 at PAYU SWIGGY',
          parsed_json: null,
          expense_id: null,
          error_reason: 'Needs manual review',
          failure_kind: 'not_receipt',
          diagnosis: {
            title: 'Capture was not recognized as an expense',
            detail: 'Khata received text but did not classify it as an expense.',
            next_action: 'Create a smart rule from the raw text and replay it.',
            replayable: true,
          },
          confidence: { overall: 42 },
          replay_count: 1,
          metadata: {},
          parsed_expense_id: null,
          parsed_expense_label: null,
          processed_at: null,
          last_replayed_at: '2026-04-28T10:10:00.000Z',
          ignored_at: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    })
  })
  await page.route('**/api/rules**', (route) =>
    route.fulfill({
      json: {
        rules: [{
          id: 'rule-1',
          user_id: 42,
          name: 'Swiggy card alerts',
          pattern: 'SWIGGY',
          match_scope: 'raw_text',
          match_type: 'contains',
          category_id: '33333333-3333-4333-8333-333333333333',
          category: 'Food',
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
          tag_names: ['food'],
          review_status: 'reviewed',
          priority: 100,
          enabled: true,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/rule-suggestions**', (route) =>
    route.fulfill({
      json: {
        suggestions: [{
          id: 'suggestion-1',
          source: 'correction',
          source_entity_type: 'expense',
          source_entity_id: expense.id,
          merchant: 'OpenAI Cafe',
          pattern: 'OpenAI Cafe',
          match_scope: 'merchant',
          match_type: 'contains',
          category_id: '33333333-3333-4333-8333-333333333333',
          category: 'Food',
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
          tag_names: ['team'],
          reason: 'Manual transaction correction',
          status: 'pending',
          smart_rule_id: null,
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
          decided_at: null,
        }],
      },
    })
  )
  await page.route('**/api/settlement/monthly**', (route) =>
    route.fulfill({
      json: {
        settlement: {
          period: { year: 2026, month: 4, start: '2026-04-01', end: '2026-04-30', label: 'April 2026' },
          total_cents: '0',
          member_count: 1,
          payers: [],
          transfers: [],
        },
      },
    }),
  )
  await page.route('**/api/ops/restore-drills', (route) =>
    route.fulfill({
      json: {
        drills: [{
          id: 'drill-1',
          status: 'passed',
          backup_key: '/backups/khata-postgres-20260428.dump',
          checked_at: '2026-04-28T10:00:00.000Z',
          duration_ms: 12000,
          detail: { pod: 'restore-drill' },
          error_reason: null,
          created_at: '2026-04-28T10:00:00.000Z',
        }],
      },
    }),
  )
  await page.route('**/api/reconciliation**', (route) =>
    route.fulfill({
      json: {
        summary: {
          period: {
            year: 2026,
            month: 4,
            start: '2026-04-01',
            end: '2026-04-30',
            label: 'April 2026',
          },
          account_id: null,
          account: null,
          expense_count: 1,
          statement_count: 1,
          matched_count: 1,
          missing_in_khata: 0,
          missing_in_statement: 1,
          amount_mismatch: 0,
          total_statement_cents: '7500',
          total_expense_cents: '125000',
        },
        items: [{
          id: 'recon-1',
          status: 'missing_in_statement',
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
          statement_row_id: null,
          expense_id: expense.id,
          amount_delta_cents: '125000',
          occurred_at: '2026-04-20',
          description: 'OpenAI Cafe',
          amount_cents: '125000',
          statement_amount_cents: null,
          currency: 'INR',
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
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
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
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
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
          currency: 'INR',
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
        }, {
          name: 'GitHub',
          merchant_key: 'github',
          currency: 'INR',
          count: 3,
          total_cents: '30000',
          first_seen: '2026-02-01',
          last_seen: '2026-04-01',
          cadence: 'monthly',
          confidence: 95,
          avg_amount_cents: '10000',
          monthly_estimate_cents: '10000',
          avg_interval_days: 30,
          interval_jitter_days: 1,
          amount_variance_pct: 0,
          charge_dates: ['2026-02-01', '2026-03-01', '2026-04-01'],
          next_expected_at: '2026-05-01',
          days_until_next: 2,
          is_overdue: false,
          not_seen_this_month: false,
          preference_status: null,
        }],
        records: [{
          id: 'sub-1',
          user_id: '42',
          merchant_key: 'minimax',
          name: 'MiniMax',
          status: 'active',
          billing_cycle: 'monthly',
          interval_days: null,
          amount_cents: '49900',
          currency: 'INR',
          category_id: '33333333-3333-4333-8333-333333333333',
          category: 'Food',
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
          payment_method: 'AmEx',
          started_at: '2026-02-01',
          next_due_at: '2026-05-01',
          days_until_next: 2,
          monthly_estimate_cents: '49900',
          yearly_estimate_cents: '598800',
          converted_monthly_estimate_cents: '49900',
          converted_yearly_estimate_cents: '598800',
          converted_amount_cents: '49900',
          activity_status: 'price_review',
          last_seen: '2026-04-01',
          detected_monthly_estimate_cents: '59900',
          price_delta_cents: '10000',
          price_delta_pct: 20,
          needs_price_review: true,
          reminder_days: [3],
          notes: null,
          logo_url: null,
          source: 'detected',
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }, {
          id: 'sub-2',
          user_id: '42',
          merchant_key: 'openai',
          name: 'OpenAI',
          status: 'active',
          billing_cycle: 'monthly',
          interval_days: null,
          amount_cents: '2000',
          currency: 'USD',
          category_id: '33333333-3333-4333-8333-333333333333',
          category: 'Food',
          account_id: '77777777-7777-4777-8777-777777777777',
          account: 'AmEx Platinum',
          payment_method: 'AmEx',
          started_at: '2026-04-01',
          next_due_at: '2026-05-04',
          days_until_next: 5,
          monthly_estimate_cents: '2000',
          yearly_estimate_cents: '24000',
          converted_monthly_estimate_cents: '166000',
          converted_yearly_estimate_cents: '1992000',
          converted_amount_cents: '166000',
          activity_status: 'due_soon',
          last_seen: null,
          detected_monthly_estimate_cents: null,
          price_delta_cents: null,
          price_delta_pct: null,
          needs_price_review: false,
          reminder_days: [3],
          notes: 'API subscription',
          logo_url: null,
          source: 'manual',
          created_at: '2026-04-28T10:00:00.000Z',
          updated_at: '2026-04-28T10:00:00.000Z',
        }],
        summary: {
          active_count: 2,
          trial_count: 0,
          paused_count: 0,
          cancelled_count: 0,
          due_soon_count: 2,
          overdue_count: 0,
          monthly_total_cents: '51900',
          yearly_total_cents: '622800',
          base_currency: 'INR',
          converted_monthly_total_cents: '215900',
          converted_yearly_total_cents: '2590800',
          price_review_count: 1,
          missing_due_date_count: 0,
          not_seen_count: 0,
          upcoming_30_days_count: 2,
          upcoming_30_days_total_cents: '215900',
          upcoming_renewals: [{
            id: 'sub-1',
            name: 'MiniMax',
            status: 'active',
            due_date: '2026-05-01',
            days_until_next: 2,
            amount_cents: '49900',
            converted_amount_cents: '49900',
            currency: 'INR',
            account: 'AmEx Platinum',
            payment_method: 'AmEx',
            activity_status: 'price_review',
          }, {
            id: 'sub-2',
            name: 'OpenAI',
            status: 'active',
            due_date: '2026-05-04',
            days_until_next: 5,
            amount_cents: '2000',
            converted_amount_cents: '166000',
            currency: 'USD',
            account: 'AmEx Platinum',
            payment_method: 'AmEx',
            activity_status: 'due_soon',
          }],
          fx: {
            base_currency: 'INR',
            source: 'frankfurter',
            rates: [{
              base_currency: 'INR',
              quote_currency: 'INR',
              rate: 1,
              source: 'identity',
              as_of: null,
              fetched_at: null,
            }, {
              base_currency: 'USD',
              quote_currency: 'INR',
              rate: 83,
              source: 'frankfurter',
              as_of: '2026-04-28',
              fetched_at: '2026-04-28T10:00:00.000Z',
            }],
            missing_currencies: [],
            stale: false,
            fetched_at: '2026-04-28T10:00:00.000Z',
          },
        },
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
          undone_at: null,
          undone_by: null,
          undo_event_id: null,
          undo_error: null,
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
      currency: 'INR',
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
        close: {
          status: 'open',
          readiness_score: 50,
          can_close: false,
          blockers: [{
            id: 'receipts',
            label: 'Review receipt OCR',
            count: 1,
            href: '/receipts?start=2026-04-01&end=2026-04-30&review_status=needs_review',
          }],
          exported_at: null,
          closed_at: null,
          reopened_at: null,
          close_note: null,
        },
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
  await expect(page.locator('.review-task', { hasText: 'Review receipt OCR' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark Exported' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close Month' })).toBeDisabled()
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

test('subscription center renders managed records and detected candidates', async ({ page }) => {
  await page.goto('/subscriptions')
  await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible()
  await expect(page.getByText('Monthly committed')).toBeVisible()
  await expect(page.locator('.subscription-hero strong', { hasText: '₹2,159.00' })).toBeVisible()
  await expect(page.getByText('Renewal timeline')).toBeVisible()
  await expect(page.getByText('+20% vs detected')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Price review' })).toBeAttached()
  await expect(page.getByRole('cell', { name: /MiniMax/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: /OpenAI/ })).toBeVisible()
  await expect(page.getByText('$20.00 / mo (₹1,660.00)')).toBeVisible()
  await expect(page.getByText('GitHub')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Subscription' })).toBeVisible()
  await expect(page.getByLabel('Subscription sort')).toBeVisible()
})

test('manage workspace renders categories, budgets, tags, and statements', async ({ page }) => {
  await page.goto('/manage')
  await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible()
  await expect(page.getByText('Categories')).toBeVisible()
  await expect(page.getByText('Ledger Access')).toBeVisible()
  await expect(page.getByText('Family Ledgers')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Partner: view + add' })).toBeAttached()
  await expect(page.getByLabel('Telegram user ID')).toBeVisible()
  await expect(page.getByText(/99 · @grace/)).toBeVisible()
  await expect(page.getByText('Budgets')).toBeVisible()
  await expect(page.getByText('#team · 1')).toBeVisible()
  await expect(page.getByText('MiniMax')).toBeVisible()
  await expect(page.getByText('Learning Suggestions')).toBeVisible()
  await expect(page.getByText('Manual transaction correction')).toBeVisible()
  await expect(page.getByText('Capture Workbench')).toBeVisible()
  await expect(page.getByLabel('Capture source')).toBeVisible()
  await expect(page.getByText('Capture was not recognized as an expense')).toBeVisible()
  await expect(page.getByText('replayed 1x')).toBeVisible()
  await page.getByRole('button', { name: 'Make Rule' }).click()
  await expect(page.getByPlaceholder('Rule name')).toHaveValue('telegram text correction')
  await expect(page.getByPlaceholder('Pattern')).toHaveValue(/Alert: INR 301/)
  await expect(page.getByText('Restore Drills')).toBeVisible()
  await expect(page.getByText('passed')).toBeVisible()
  await expect(page.getByLabel('Statement file')).toBeVisible()
  await page.getByRole('button', { name: 'Review' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Import Review')).toBeVisible()
  await expect(page.getByLabel('Bulk statement category')).toBeVisible()
  await expect(page.getByLabel('Tags for Metro card')).toHaveValue('commute')
  await expect(page.getByText('expense update')).toBeVisible()
})
