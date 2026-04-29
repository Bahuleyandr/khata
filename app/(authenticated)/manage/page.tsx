'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearBudget,
  clearSubscriptionPreference,
  createCategory,
  deleteCategory,
  formatCents,
  formatDate,
  getAuditLog,
  getBudgets,
  getCategories,
  getStatementRows,
  getStatements,
  getSubscriptions,
  getTags,
  importStatementRows,
  renameCategory,
  retryStatement,
  setBudget,
  setSubscriptionPreference,
  updateStatementImportRow,
  uploadStatement,
  type AuditEvent,
  type BudgetVariance,
  type Category,
  type StatementImport,
  type StatementImportRow,
  type SubscriptionCandidate,
  type SubscriptionPreferenceStatus,
  type Tag,
} from '../../../lib/api'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function rupeesToCents(value: string) {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [rupees, paise = ''] = cleaned.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

function formatAuditDate(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function auditLabel(event: AuditEvent) {
  return event.action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' ')
}

function formatAuditJson(value: unknown) {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value, null, 2) ?? 'null'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatAuditCell(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value) ?? 'null'
  return String(value)
}

function auditDiff(event: AuditEvent) {
  const before = event.before
  const after = event.after
  if (!isRecord(before) || !isRecord(after)) return []
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  return keys
    .map((key) => ({
      field: key,
      before: before[key],
      after: after[key],
    }))
    .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after))
}

function parseTagNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  )
}

type SubscriptionFilter = 'active' | 'attention' | 'confirmed' | 'ignored' | 'inactive' | 'all'

const AUDIT_ACTION_OPTIONS = [
  'expense.create',
  'expense.update',
  'expense.delete',
  'expense.merge',
  'expenses.bulk_update',
  'statement.upload',
  'statement.import',
  'statement.row_update',
  'subscription.preference_set',
  'subscription.preference_clear',
]

const AUDIT_ENTITY_OPTIONS = ['expense', 'statement', 'statement_row', 'subscription', 'category', 'budget', 'tag']

function subscriptionTiming(subscription: SubscriptionCandidate) {
  if (subscription.next_expected_at === null || subscription.days_until_next === null) return 'Timing unknown'
  if (subscription.days_until_next < 0) {
    return `Expected ${Math.abs(subscription.days_until_next)} days ago`
  }
  if (subscription.days_until_next === 0) return 'Expected today'
  return `Expected in ${subscription.days_until_next} days`
}

function subscriptionBadgeClass(status: SubscriptionPreferenceStatus) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'inactive') return 'badge-inactive'
  return 'badge-muted'
}

export default function ManagePage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<BudgetVariance[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [statements, setStatements] = useState<StatementImport[]>([])
  const [statementRows, setStatementRows] = useState<StatementImportRow[]>([])
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [selectedStatementRowIds, setSelectedStatementRowIds] = useState<string[]>([])
  const [bulkStatementCategory, setBulkStatementCategory] = useState('')
  const [bulkStatementTags, setBulkStatementTags] = useState('')
  const [subscriptions, setSubscriptions] = useState<SubscriptionCandidate[]>([])
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>('active')
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditDetail, setAuditDetail] = useState<AuditEvent | null>(null)
  const [auditLimit, setAuditLimit] = useState(30)
  const [auditAction, setAuditAction] = useState('')
  const [auditEntityType, setAuditEntityType] = useState('')
  const [month, setMonth] = useState(currentMonthValue)
  const [newCategory, setNewCategory] = useState('')
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [statementInputKey, setStatementInputKey] = useState(0)
  const [statementUploadResult, setStatementUploadResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    const [cats, budgetRes, tagRes, statementRes, subscriptionRes, auditRes] = await Promise.all([
      getCategories(),
      getBudgets(month),
      getTags(),
      getStatements(),
      getSubscriptions({ includeIgnored: true }),
      getAuditLog({
        limit: auditLimit,
        action: auditAction || undefined,
        entityType: auditEntityType || undefined,
      }),
    ])
    setCategories(cats)
    setBudgets(budgetRes.budgets)
    setTags(tagRes.tags)
    setStatements(statementRes.statements)
    setSubscriptions(subscriptionRes.subscriptions)
    setAuditEvents(auditRes.events)
    setBudgetCategory((current) => current || cats[0]?.id || '')
  }, [auditAction, auditEntityType, auditLimit, month])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

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

  const pendingStatementRows = statementRows.filter((row) => row.status === 'pending')
  const selectedPendingRowIds = selectedStatementRowIds.filter((id) =>
    pendingStatementRows.some((row) => row.id === id),
  )
  const activeSubscriptions = subscriptions.filter(
    (subscription) => !['ignored', 'inactive'].includes(subscription.preference_status ?? ''),
  )
  const attentionSubscriptions = activeSubscriptions.filter(
    (subscription) => subscription.is_overdue || subscription.not_seen_this_month,
  )
  const confirmedSubscriptions = subscriptions.filter((subscription) => subscription.preference_status === 'confirmed')
  const subscriptionMonthlyTotal = (
    confirmedSubscriptions.length > 0 ? confirmedSubscriptions : activeSubscriptions
  ).reduce((sum, subscription) => sum + Number(subscription.monthly_estimate_cents), 0)
  const filteredSubscriptions = subscriptions.filter((subscription) => {
    if (subscriptionFilter === 'all') return true
    if (subscriptionFilter === 'active') return !['ignored', 'inactive'].includes(subscription.preference_status ?? '')
    if (subscriptionFilter === 'attention') return subscription.is_overdue || subscription.not_seen_this_month
    return subscription.preference_status === subscriptionFilter
  })
  const auditActions = useMemo(
    () => Array.from(new Set([...AUDIT_ACTION_OPTIONS, ...auditEvents.map((event) => event.action)])).sort(),
    [auditEvents],
  )
  const auditEntityTypes = useMemo(
    () => Array.from(new Set([...AUDIT_ENTITY_OPTIONS, ...auditEvents.map((event) => event.entity_type)])).sort(),
    [auditEvents],
  )

  async function loadStatementReview(statementId: string) {
    const res = await getStatementRows(statementId)
    setSelectedStatementId(statementId)
    setStatementRows(res.rows)
    setSelectedStatementRowIds(res.rows.filter((row) => row.status === 'pending').map((row) => row.id))
  }

  function toggleStatementRow(rowId: string, checked: boolean) {
    setSelectedStatementRowIds((ids) =>
      checked ? Array.from(new Set([...ids, rowId])) : ids.filter((id) => id !== rowId),
    )
  }

  async function importSelectedRows(rowIds?: string[]) {
    if (!selectedStatementId) return
    const result = await importStatementRows(selectedStatementId, rowIds)
    setStatementUploadResult(`${result.imported_count} imported from reviewed statement rows`)
    await loadStatementReview(selectedStatementId)
  }

  async function ignoreSelectedRows() {
    if (!selectedStatementId || selectedPendingRowIds.length === 0) return
    await Promise.all(
      selectedPendingRowIds.map((rowId) => updateStatementImportRow(selectedStatementId, rowId, { status: 'ignored' })),
    )
    await loadStatementReview(selectedStatementId)
  }

  async function restoreStatementRow(rowId: string) {
    if (!selectedStatementId) return
    await updateStatementImportRow(selectedStatementId, rowId, { status: 'pending' })
    await loadStatementReview(selectedStatementId)
  }

  async function saveStatementRowCorrection(
    rowId: string,
    data: { category_id: string | null; tag_names: string[] },
  ) {
    if (!selectedStatementId) return
    await updateStatementImportRow(selectedStatementId, rowId, data)
    await loadStatementReview(selectedStatementId)
  }

  async function applyCorrectionsToSelected() {
    if (!selectedStatementId || selectedPendingRowIds.length === 0) return
    const body: { category_id?: string | null; tag_names?: string[] } = {}
    if (bulkStatementCategory === '__none__') body.category_id = null
    else if (bulkStatementCategory) body.category_id = bulkStatementCategory
    if (bulkStatementTags.trim()) body.tag_names = parseTagNames(bulkStatementTags)
    if (!Object.keys(body).length) {
      throw new Error('Choose a category or enter tags to apply.')
    }
    await Promise.all(
      selectedPendingRowIds.map((rowId) => updateStatementImportRow(selectedStatementId, rowId, body)),
    )
    setBulkStatementTags('')
    await loadStatementReview(selectedStatementId)
  }

  async function reparseStatement(statementId: string) {
    const result = await retryStatement(statementId)
    setStatementUploadResult(
      `${result.parsed_count} parsed for review · ${result.duplicate_count} duplicates`,
    )
    setSelectedStatementId(statementId)
    setStatementRows(result.rows)
    setSelectedStatementRowIds(result.rows.filter((row) => row.status === 'pending').map((row) => row.id))
  }

  async function updateSubscription(subscription: SubscriptionCandidate, status: SubscriptionPreferenceStatus) {
    await setSubscriptionPreference(subscription.merchant_key, subscription.name, status)
  }

  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    await createCategory(name)
    setNewCategory('')
  }

  async function saveBudget() {
    const cents = rupeesToCents(budgetAmount)
    if (!budgetCategory || !cents) {
      setError('Choose a category and enter a valid amount.')
      return
    }
    await setBudget(budgetCategory, cents)
    setBudgetAmount('')
  }

  async function uploadSelectedStatement() {
    if (!statementFile) {
      setError('Choose a PDF or statement image first.')
      return
    }
    const result = await uploadStatement(statementFile)
    setStatementUploadResult(
      `${result.parsed_count} parsed for review · ${result.duplicate_count} duplicates`,
    )
    setSelectedStatementId(result.statement.id)
    setStatementRows(result.rows)
    setSelectedStatementRowIds(result.rows.filter((row) => row.status === 'pending').map((row) => row.id))
    setStatementFile(null)
    setStatementInputKey((key) => key + 1)
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Manage</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Budget month" />
      </div>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="grid-2">
        <section className="card workspace-card">
          <h3>Categories</h3>
          <div className="inline-form">
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category" />
            <button type="button" onClick={() => void run(addCategory)} disabled={busy}>Add</button>
          </div>
          <div className="stack-list">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                busy={busy}
                onRename={(name) => run(() => renameCategory(category.id, name).then(() => undefined))}
                onDelete={() => run(() => deleteCategory(category.id))}
              />
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Budgets</h3>
          <div className="inline-form">
            <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <input
              inputMode="decimal"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Monthly budget"
            />
            <button type="button" onClick={() => void run(saveBudget)} disabled={busy}>Set</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th style={{ textAlign: 'right' }}>Target</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {budgets.length === 0 ? (
                <tr><td colSpan={4}>No budgets yet.</td></tr>
              ) : budgets.map((budget) => (
                <tr key={budget.id}>
                  <td>{budget.category_name}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.spent_cents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.target_cents)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" onClick={() => void run(() => clearBudget(budget.category_id))} disabled={busy}>
                      Clear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card workspace-card">
          <h3>Tags</h3>
          <div className="tag-cloud">
            {tags.length === 0 ? <span>No tags yet.</span> : tags.map((tag) => (
              <span key={tag.id}>#{tag.name} · {tag.count}</span>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Subscriptions</h3>
          <div className="subscription-summary-grid">
            <span>
              <strong>{formatCents(subscriptionMonthlyTotal)}</strong>
              <small>monthly watch</small>
            </span>
            <span>
              <strong>{confirmedSubscriptions.length}</strong>
              <small>confirmed</small>
            </span>
            <span>
              <strong>{attentionSubscriptions.length}</strong>
              <small>need attention</small>
            </span>
          </div>
          <div className="segmented-control subscription-filter" aria-label="Subscription filter">
            {([
              ['active', `Active ${activeSubscriptions.length}`],
              ['attention', `Attention ${attentionSubscriptions.length}`],
              ['confirmed', `Confirmed ${confirmedSubscriptions.length}`],
              ['ignored', 'Ignored'],
              ['inactive', 'Inactive'],
              ['all', 'All'],
            ] as Array<[SubscriptionFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={subscriptionFilter === value ? 'active' : ''}
                onClick={() => setSubscriptionFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="statement-list">
            {filteredSubscriptions.length === 0 ? <p>No recurring signals in this view.</p> : filteredSubscriptions.map((subscription) => (
              <div key={subscription.merchant_key} className="statement-row subscription-row">
                <div>
                  <strong>
                    {subscription.name}
                    {subscription.preference_status ? (
                      <span className={`badge ${subscriptionBadgeClass(subscription.preference_status)}`}>
                        {subscription.preference_status}
                      </span>
                    ) : null}
                    {subscription.is_overdue ? <span className="badge badge-review">Overdue</span> : null}
                  </strong>
                  <span>
                    {subscription.cadence} · {formatCents(subscription.monthly_estimate_cents)} / mo · {subscription.confidence}% · {subscription.count} charges
                  </span>
                  <small>
                    {subscriptionTiming(subscription)}
                    {subscription.last_seen ? ` · Last ${formatDate(subscription.last_seen)}` : ''}
                    {subscription.not_seen_this_month ? ' · Not seen this month' : ''}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'confirmed'))}
                    disabled={busy || subscription.preference_status === 'confirmed'}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'ignored'))}
                    disabled={busy || subscription.preference_status === 'ignored'}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'inactive'))}
                    disabled={busy || subscription.preference_status === 'inactive'}
                  >
                    Inactive
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => clearSubscriptionPreference(subscription.merchant_key))}
                    disabled={busy || !subscription.preference_status}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Statement Imports</h3>
          <div className="statement-upload-panel">
            <input
              key={statementInputKey}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                setStatementFile(e.target.files?.[0] ?? null)
                setStatementUploadResult(null)
              }}
              aria-label="Statement file"
            />
            <button
              type="button"
              className="button-primary"
              onClick={() => void run(uploadSelectedStatement)}
              disabled={busy || !statementFile}
            >
              Upload
            </button>
            {statementUploadResult ? <span>{statementUploadResult}</span> : null}
          </div>
          <div className="statement-list">
            {statements.length === 0 ? <p>No statement imports yet.</p> : statements.map((statement) => (
              <div key={statement.id} className="statement-row">
                <div>
                  <strong>{statement.status}</strong>
                  <span>
                    {statement.parsed_count} parsed · {statement.imported_count} imported · {statement.duplicate_count} duplicates
                  </span>
                  {statement.error_reason ? <small>{statement.error_reason}</small> : null}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void run(() => loadStatementReview(statement.id))}
                    disabled={busy}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => reparseStatement(statement.id))}
                    disabled={busy || !['failed', 'parsed'].includes(statement.status)}
                  >
                    Re-parse
                  </button>
                </div>
              </div>
            ))}
          </div>
          {selectedStatementId ? (
            <div className="statement-review-panel">
              <div className="statement-review-toolbar">
                <div>
                  <strong>Import Review</strong>
                  <span>{pendingStatementRows.length} pending · {statementRows.length} total rows</span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => setSelectedStatementRowIds(pendingStatementRows.map((row) => row.id))}
                    disabled={busy || pendingStatementRows.length === 0}
                  >
                    Select pending
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => importSelectedRows(selectedPendingRowIds))}
                    disabled={busy || selectedPendingRowIds.length === 0}
                  >
                    Import selected
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => importSelectedRows())}
                    disabled={busy || pendingStatementRows.length === 0}
                  >
                    Import all
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(ignoreSelectedRows)}
                    disabled={busy || selectedPendingRowIds.length === 0}
                  >
                    Ignore selected
                  </button>
                </div>
              </div>
              <div className="statement-correction-bar">
                <select
                  value={bulkStatementCategory}
                  onChange={(e) => setBulkStatementCategory(e.target.value)}
                  aria-label="Bulk statement category"
                >
                  <option value="">Keep category</option>
                  <option value="__none__">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <input
                  value={bulkStatementTags}
                  onChange={(e) => setBulkStatementTags(e.target.value)}
                  placeholder="Tags: travel, reimbursable"
                  aria-label="Bulk statement tags"
                />
                <button
                  type="button"
                  onClick={() => void run(applyCorrectionsToSelected)}
                  disabled={busy || selectedPendingRowIds.length === 0}
                >
                  Apply to selected
                </button>
              </div>
              <div className="table-scroll">
                <table className="statement-review-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Suggested</th>
                      <th>Category</th>
                      <th>Tags</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementRows.length === 0 ? (
                      <tr><td colSpan={9}>No parsed rows for this statement.</td></tr>
                    ) : statementRows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Select">
                          <input
                            type="checkbox"
                            checked={selectedStatementRowIds.includes(row.id)}
                            onChange={(e) => toggleStatementRow(row.id, e.target.checked)}
                            disabled={row.status !== 'pending'}
                            aria-label={`Select ${row.description}`}
                          />
                        </td>
                        <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.occurred_at)}</td>
                        <td data-label="Description">{row.description}</td>
                        <td data-label="Suggested">{row.suggested_category ?? '—'}</td>
                        <td data-label="Category">{row.category ?? 'Uncategorized'}</td>
                        <td data-label="Tags">{row.tag_names.length ? row.tag_names.map((tag) => `#${tag}`).join(' ') : '—'}</td>
                        <td data-label="Status"><span className={`badge badge-${row.status}`}>{row.status}</span></td>
                        <td data-label="Amount" style={{ textAlign: 'right', fontWeight: 600 }}>{formatCents(row.amount_cents, row.currency)}</td>
                        <td data-label="Actions">
                          <div className="row-actions">
                            {row.status === 'pending' ? (
                              <StatementRowCorrection
                                row={row}
                                categories={categories}
                                busy={busy}
                                onSave={(data) => run(() => saveStatementRowCorrection(row.id, data))}
                              />
                            ) : null}
                            {row.status === 'ignored' ? (
                              <button
                                type="button"
                                onClick={() => void run(() => restoreStatementRow(row.id))}
                                disabled={busy}
                              >
                                Restore
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card workspace-card wide-card">
          <h3>Audit Trail</h3>
          <div className="audit-filter-bar">
            <select
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              aria-label="Audit action"
            >
              <option value="">All actions</option>
              {auditActions.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
            <select
              value={auditEntityType}
              onChange={(e) => setAuditEntityType(e.target.value)}
              aria-label="Audit entity type"
            >
              <option value="">All entities</option>
              {auditEntityTypes.map((entityType) => (
                <option key={entityType} value={entityType}>{entityType}</option>
              ))}
            </select>
            <select
              value={auditLimit}
              onChange={(e) => setAuditLimit(Number(e.target.value))}
              aria-label="Audit limit"
            >
              {[30, 50, 100].map((limit) => (
                <option key={limit} value={limit}>{limit} events</option>
              ))}
            </select>
          </div>
          <div className="statement-list">
            {auditEvents.length === 0 ? <p>No corrections recorded yet.</p> : auditEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className="statement-row audit-row"
                onClick={() => setAuditDetail(event)}
              >
                <div>
                  <strong>{auditLabel(event)}</strong>
                  <span>
                    {event.entity_type}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ''} · {formatAuditDate(event.created_at)}
                  </span>
                </div>
                <span>Details</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {auditDetail ? (
        <div className="modal-overlay">
          <div className="modal audit-detail-modal" role="dialog" aria-modal="true" aria-label="Audit Event">
            <h3>{auditLabel(auditDetail)}</h3>
            <p>
              {auditDetail.entity_type}
              {auditDetail.entity_id ? ` · ${auditDetail.entity_id}` : ''}
              {' · '}
              {formatAuditDate(auditDetail.created_at)}
            </p>
            {auditDiff(auditDetail).length > 0 ? (
              <section className="audit-diff">
                <h4>Changed Fields</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditDiff(auditDetail).map((row) => (
                      <tr key={row.field}>
                        <td>{row.field}</td>
                        <td>{formatAuditCell(row.before)}</td>
                        <td>{formatAuditCell(row.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            <div className="audit-json-grid">
              <section>
                <h4>Before</h4>
                <pre>{formatAuditJson(auditDetail.before)}</pre>
              </section>
              <section>
                <h4>After</h4>
                <pre>{formatAuditJson(auditDetail.after)}</pre>
              </section>
              <section>
                <h4>Metadata</h4>
                <pre>{formatAuditJson(auditDetail.metadata)}</pre>
              </section>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setAuditDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CategoryRow({
  category,
  busy,
  onRename,
  onDelete,
}: {
  category: Category
  busy: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(category.name)

  useEffect(() => setName(category.name), [category.name])

  return (
    <div className="list-row">
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => void onRename(name)} disabled={busy || name.trim() === category.name}>
        Rename
      </button>
      <button type="button" onClick={() => void onDelete()} disabled={busy || category.is_default}>
        Delete
      </button>
    </div>
  )
}

function StatementRowCorrection({
  row,
  categories,
  busy,
  onSave,
}: {
  row: StatementImportRow
  categories: Category[]
  busy: boolean
  onSave: (data: { category_id: string | null; tag_names: string[] }) => Promise<void>
}) {
  const [categoryId, setCategoryId] = useState(row.category_id ?? '')
  const [tagText, setTagText] = useState(row.tag_names.join(', '))

  useEffect(() => {
    setCategoryId(row.category_id ?? '')
    setTagText(row.tag_names.join(', '))
  }, [row.category_id, row.tag_names])

  return (
    <div className="statement-row-correction">
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        disabled={busy}
        aria-label={`Category for ${row.description}`}
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
      <input
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        disabled={busy}
        placeholder="tags"
        aria-label={`Tags for ${row.description}`}
      />
      <button
        type="button"
        onClick={() => void onSave({ category_id: categoryId || null, tag_names: parseTagNames(tagText) })}
        disabled={busy}
      >
        Save
      </button>
    </div>
  )
}
