'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearSubscriptionPreference,
  confirmSubscriptionCandidate,
  createSubscriptionRecord,
  deleteSubscriptionRecord,
  formatCents,
  formatDate,
  getAccounts,
  getCategories,
  getSubscriptions,
  setSubscriptionPreference,
  updateSubscriptionRecord,
  type Account,
  type BillingCycle,
  type Category,
  type ManagedSubscription,
  type ManagedSubscriptionStatus,
  type SubscriptionCandidate,
  type SubscriptionRecordInput,
  type SubscriptionSummary,
} from '../../../lib/api'

type ViewFilter = 'active' | 'due' | 'paused' | 'cancelled' | 'all'
type SortKey = 'due' | 'amount' | 'name' | 'category'

type FormState = {
  id: string | null
  name: string
  status: ManagedSubscriptionStatus
  billing_cycle: BillingCycle
  amount: string
  currency: string
  category_id: string
  account_id: string
  payment_method: string
  started_at: string
  next_due_at: string
  interval_days: string
  reminder_days: string
  notes: string
  logo_url: string
  merchant_key: string
}

const emptyForm: FormState = {
  id: null,
  name: '',
  status: 'active',
  billing_cycle: 'monthly',
  amount: '',
  currency: 'INR',
  category_id: '',
  account_id: '',
  payment_method: '',
  started_at: '',
  next_due_at: '',
  interval_days: '',
  reminder_days: '3',
  notes: '',
  logo_url: '',
  merchant_key: '',
}

function centsFromAmount(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0
}

function amountFromCents(value: string | number): string {
  const amount = Number(value) / 100
  return Number.isFinite(amount) ? amount.toFixed(2) : ''
}

function dueLabel(record: Pick<ManagedSubscription, 'next_due_at' | 'days_until_next'>) {
  if (!record.next_due_at || record.days_until_next === null) return 'No due date'
  if (record.days_until_next < 0) return `${Math.abs(record.days_until_next)} days overdue`
  if (record.days_until_next === 0) return 'Due today'
  if (record.days_until_next === 1) return 'Due tomorrow'
  return `Due in ${record.days_until_next} days`
}

function statusClass(status: ManagedSubscriptionStatus) {
  if (status === 'active' || status === 'trial') return 'badge-confirmed'
  if (status === 'paused') return 'badge-review'
  return 'badge-muted'
}

function candidateCadenceLabel(candidate: SubscriptionCandidate) {
  const timing = candidate.next_expected_at ? `next ${formatDate(candidate.next_expected_at)}` : 'next date unknown'
  return `${candidate.cadence} · ${formatCents(candidate.monthly_estimate_cents, candidate.currency)} / mo · ${timing}`
}

function monthlyDisplay(record: ManagedSubscription, baseCurrency: string) {
  const original = `${formatCents(record.monthly_estimate_cents, record.currency)} / mo`
  if (
    record.converted_monthly_estimate_cents &&
    record.currency !== baseCurrency
  ) {
    return `${original} (${formatCents(record.converted_monthly_estimate_cents, baseCurrency)})`
  }
  return original
}

function toInput(record: ManagedSubscription): FormState {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    billing_cycle: record.billing_cycle,
    amount: amountFromCents(record.amount_cents),
    currency: record.currency,
    category_id: record.category_id ?? '',
    account_id: record.account_id ?? '',
    payment_method: record.payment_method ?? '',
    started_at: record.started_at ?? '',
    next_due_at: record.next_due_at ?? '',
    interval_days: record.interval_days ? String(record.interval_days) : '',
    reminder_days: record.reminder_days.join(', '),
    notes: record.notes ?? '',
    logo_url: record.logo_url ?? '',
    merchant_key: record.merchant_key ?? '',
  }
}

function toPayload(form: FormState): SubscriptionRecordInput {
  return {
    name: form.name.trim(),
    status: form.status,
    billing_cycle: form.billing_cycle,
    amount_cents: centsFromAmount(form.amount),
    currency: form.currency.trim().toUpperCase() || 'INR',
    category_id: form.category_id || null,
    account_id: form.account_id || null,
    payment_method: form.payment_method.trim() || null,
    started_at: form.started_at || null,
    next_due_at: form.next_due_at || null,
    interval_days: form.billing_cycle === 'custom' && form.interval_days ? Number(form.interval_days) : null,
    reminder_days: form.reminder_days
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((day) => Number.isFinite(day) && day >= 0),
    notes: form.notes.trim() || null,
    logo_url: form.logo_url.trim() || null,
    merchant_key: form.merchant_key.trim() || null,
  }
}

export default function SubscriptionsPage() {
  const [records, setRecords] = useState<ManagedSubscription[]>([])
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null)
  const [candidates, setCandidates] = useState<SubscriptionCandidate[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [filter, setFilter] = useState<ViewFilter>('active')
  const [sort, setSort] = useState<SortKey>('due')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    const [subscriptionRes, categoryRes, accountRes] = await Promise.all([
      getSubscriptions({ includeIgnored: true }),
      getCategories(),
      getAccounts(),
    ])
    setRecords(subscriptionRes.records ?? [])
    setSummary(subscriptionRes.summary ?? null)
    setCandidates(subscriptionRes.subscriptions)
    setCategories(categoryRes)
    setAccounts(accountRes.accounts)
  }, [])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

  const managedKeys = useMemo(
    () => new Set(records.map((record) => record.merchant_key).filter(Boolean)),
    [records],
  )
  const reviewCandidates = candidates.filter((candidate) => !managedKeys.has(candidate.merchant_key))
  const baseCurrency = summary?.base_currency ?? 'INR'
  const monthlyCommitted = summary?.converted_monthly_total_cents ?? summary?.monthly_total_cents ?? 0
  const yearlyCommitted = summary?.converted_yearly_total_cents ?? summary?.yearly_total_cents ?? 0
  const fxNote = summary?.fx?.missing_currencies.length
    ? `Missing FX for ${summary.fx.missing_currencies.join(', ')}`
    : summary?.fx?.stale
      ? 'Using cached FX rates'
      : summary?.fx?.fetched_at
        ? `FX updated ${formatDate(summary.fx.fetched_at)}`
        : `Base ${baseCurrency}`

  const filteredRecords = useMemo(() => {
    const filtered = records.filter((record) => {
      if (filter === 'all') return true
      if (filter === 'active') return record.status === 'active' || record.status === 'trial'
      if (filter === 'due') return record.days_until_next !== null && record.days_until_next <= 7 && record.status !== 'cancelled'
      return record.status === filter
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'amount') {
        return Number(b.converted_monthly_estimate_cents ?? b.monthly_estimate_cents) -
          Number(a.converted_monthly_estimate_cents ?? a.monthly_estimate_cents)
      }
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'category') return (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name)
      return (a.days_until_next ?? 99999) - (b.days_until_next ?? 99999) || a.name.localeCompare(b.name)
    })
  }, [filter, records, sort])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveForm() {
    const payload = toPayload(form)
    if (!payload.name || payload.amount_cents <= 0) {
      throw new Error('Name and amount are required.')
    }
    if (form.id) await updateSubscriptionRecord(form.id, payload)
    else await createSubscriptionRecord(payload)
    setForm(emptyForm)
  }

  function editRecord(record: ManagedSubscription) {
    setForm(toInput(record))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function removeRecord(record: ManagedSubscription) {
    if (!window.confirm(`Delete ${record.name}?`)) return
    await deleteSubscriptionRecord(record.id)
    if (form.id === record.id) setForm(emptyForm)
  }

  async function confirmCandidate(candidate: SubscriptionCandidate) {
    await confirmSubscriptionCandidate(candidate)
  }

  return (
    <div className="page subscriptions-page">
      <div className="page-heading">
        <div>
          <h2>Subscriptions</h2>
        </div>
      </div>

      {error ? <div className="error-msg">{error}</div> : null}

      <section className="subscription-hero card">
        <div>
          <span>Monthly committed</span>
          <strong>{formatCents(monthlyCommitted, baseCurrency)}</strong>
          <small>{formatCents(yearlyCommitted, baseCurrency)} per year · {fxNote}</small>
        </div>
        <div>
          <span>Active</span>
          <strong>{summary ? summary.active_count + summary.trial_count : 0}</strong>
          <small>{summary?.paused_count ?? 0} paused</small>
        </div>
        <div>
          <span>Due soon</span>
          <strong>{summary?.due_soon_count ?? 0}</strong>
          <small>{summary?.overdue_count ?? 0} overdue</small>
        </div>
        <div>
          <span>Detected</span>
          <strong>{reviewCandidates.length}</strong>
          <small>waiting for review</small>
        </div>
      </section>

      <div className="subscription-layout">
        <section className="card subscription-form-card">
          <h3>{form.id ? 'Edit Subscription' : 'Add Subscription'}</h3>
          <div className="form-grid">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Amount
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label>
              Currency
              <input value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ManagedSubscriptionStatus })}>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label>
              Billing
              <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as BillingCycle })}>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>
              Custom days
              <input
                inputMode="numeric"
                value={form.interval_days}
                disabled={form.billing_cycle !== 'custom'}
                onChange={(e) => setForm({ ...form, interval_days: e.target.value })}
              />
            </label>
            <label>
              Category
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">None</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              Account / card
              <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="">None</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <label>
              Payment method
              <input value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} />
            </label>
            <label>
              Started
              <input type="date" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })} />
            </label>
            <label>
              Next due
              <input type="date" value={form.next_due_at} onChange={(e) => setForm({ ...form, next_due_at: e.target.value })} />
            </label>
            <label>
              Reminder days
              <input value={form.reminder_days} onChange={(e) => setForm({ ...form, reminder_days: e.target.value })} />
            </label>
            <label>
              Logo URL
              <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} />
            </label>
            <label>
              Merchant key
              <input value={form.merchant_key} onChange={(e) => setForm({ ...form, merchant_key: e.target.value })} />
            </label>
            <label className="form-grid-wide">
              Notes
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => void run(saveForm)} disabled={busy}>
              {form.id ? 'Save Changes' : 'Add Subscription'}
            </button>
            {form.id ? (
              <button type="button" onClick={() => setForm(emptyForm)} disabled={busy}>Cancel</button>
            ) : null}
          </div>
        </section>

        <section className="card subscription-list-card">
          <div className="chart-card-heading">
            <div>
              <span>Subscription center</span>
              <h3>Managed recurring payments</h3>
            </div>
            <div className="toolbar-inline">
              <select value={filter} onChange={(e) => setFilter(e.target.value as ViewFilter)} aria-label="Subscription view">
                <option value="active">Active</option>
                <option value="due">Due soon</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
                <option value="all">All</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Subscription sort">
                <option value="due">Due date</option>
                <option value="amount">Amount</option>
                <option value="name">Name</option>
                <option value="category">Category</option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Billing</th>
                  <th>Due</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th style={{ textAlign: 'right' }}>Monthly</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={7}>No subscriptions in this view.</td></tr>
                ) : filteredRecords.map((record) => (
                  <tr key={record.id}>
                    <td data-label="Name">
                      <strong>{record.name}</strong>
                      <span className={`badge ${statusClass(record.status)}`}>{record.status}</span>
                      {record.source === 'detected' ? <span className="badge badge-muted">detected</span> : null}
                    </td>
                    <td data-label="Billing">{record.billing_cycle}</td>
                    <td data-label="Due">
                      {dueLabel(record)}
                      {record.next_due_at ? <small>{formatDate(record.next_due_at)}</small> : null}
                    </td>
                    <td data-label="Category">{record.category ?? 'None'}</td>
                    <td data-label="Account">{record.account ?? record.payment_method ?? 'None'}</td>
                    <td data-label="Monthly" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {monthlyDisplay(record, baseCurrency)}
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button type="button" onClick={() => editRecord(record)}>Edit</button>
                        <button type="button" onClick={() => void run(() => removeRecord(record))} disabled={busy}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card subscription-detection-card">
        <div className="chart-card-heading">
          <div>
            <span>Detected from spending</span>
            <h3>Recurring candidates</h3>
          </div>
        </div>
        <div className="statement-list">
          {reviewCandidates.length === 0 ? <p>No unreviewed recurring candidates.</p> : reviewCandidates.map((candidate) => (
            <div key={candidate.merchant_key} className="statement-row subscription-row">
              <div>
                <strong>
                  {candidate.name}
                  {candidate.preference_status ? <span className="badge badge-muted">{candidate.preference_status}</span> : null}
                  {candidate.is_overdue ? <span className="badge badge-review">overdue</span> : null}
                </strong>
                <span>{candidateCadenceLabel(candidate)}</span>
                <small>
                  {candidate.confidence}% confidence · {candidate.count} charges · variance {candidate.amount_variance_pct}%
                </small>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => void run(() => confirmCandidate(candidate))} disabled={busy}>
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => setSubscriptionPreference(candidate.merchant_key, candidate.name, 'ignored'))}
                  disabled={busy}
                >
                  Ignore
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => clearSubscriptionPreference(candidate.merchant_key))}
                  disabled={busy || !candidate.preference_status}
                >
                  Clear
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
