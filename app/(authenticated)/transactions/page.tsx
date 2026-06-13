'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createExpense,
  deleteExpense,
  formatCents,
  formatDate,
  addExpenseTag,
  attachReceipt,
  bulkUpdateExpenses,
  getAccounts,
  getCategories,
  getDuplicateCandidates,
  getExpenses,
  getTags,
  mergeExpense,
  removeExpenseTag,
  updateExpense,
  withLedgerParam,
  type Account,
  type Category,
  type Expense,
  type Tag,
} from '../../../lib/api'

const SOURCE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Bot', value: 'bot' },
  { label: 'Statement', value: 'statement' },
  { label: 'Receipt', value: 'receipt' },
]

type EditDraft = {
  amount: string
  date: string
  merchant: string
  description: string
  categoryId: string
  accountId: string
  reviewStatus: 'needs_review' | 'reviewed' | 'ignored'
  tags: string
}

function sourceBadgeClass(source: string) {
  if (source === 'telegram') return 'badge badge-telegram'
  if (source === 'statement') return 'badge badge-statement'
  if (source === 'receipt') return 'badge badge-receipt'
  return 'badge'
}

function sourceBadgeLabel(source: string) {
  if (source === 'telegram') return 'bot'
  return source
}

function dateInputValue(iso: string) {
  return new Date(iso).toISOString().slice(0, 10)
}

function todayInputValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function centsToAmountInput(cents: string) {
  return (parseInt(cents, 10) / 100).toFixed(2)
}

function parseAmountCents(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [rupees, paise = ''] = cleaned.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

function expenseTitle(expense: Expense) {
  return expense.merchant ?? expense.description ?? 'Untitled transaction'
}

function makeDraft(expense: Expense): EditDraft {
  return {
    amount: centsToAmountInput(expense.amount_cents),
    date: dateInputValue(expense.occurred_at),
    merchant: expense.merchant ?? '',
    description: expense.description ?? '',
    categoryId: expense.category_id ?? '',
    accountId: expense.account_id ?? '',
    reviewStatus: expense.review_status,
    tags: expense.tags.join(', '),
  }
}

function makeCreateDraft(): EditDraft {
  return {
    amount: '',
    date: todayInputValue(),
    merchant: '',
    description: '',
    categoryId: '',
    accountId: '',
    reviewStatus: 'reviewed',
    tags: '',
  }
}

export default function TransactionsPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')
  const [merchant, setMerchant] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [tag, setTag] = useState('')
  const [uncategorized, setUncategorized] = useState(false)
  const [hasReceipt, setHasReceipt] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [accountId, setAccountId] = useState('')
  const [duplicates, setDuplicates] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkAccountId, setBulkAccountId] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkReviewStatus, setBulkReviewStatus] = useState('')

  const [editing, setEditing] = useState<Expense | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<EditDraft>(makeCreateDraft)
  const [mergeTarget, setMergeTarget] = useState<Expense | null>(null)
  const [mergeDuplicateId, setMergeDuplicateId] = useState('')
  const [mergeCandidates, setMergeCandidates] = useState<Expense[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(
    async (p: number, st: string, en: string, cat: string, src: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await getExpenses({
          page: p,
          limit: 20,
          start: st,
          end: en,
          category: cat,
          source: src,
          merchant,
          minAmountCents: parseAmountCents(minAmount) ?? undefined,
          maxAmountCents: parseAmountCents(maxAmount) ?? undefined,
          tag,
          uncategorized,
          hasReceipt: hasReceipt === '' ? undefined : hasReceipt === 'yes',
          reviewStatus,
          duplicates,
          accountId,
        })
        setExpenses(res.data)
        setTotal(res.total)
        setPage(res.page)
        setTotalPages(res.totalPages)
        setSelectedIds((ids) => ids.filter((id) => res.data.some((expense) => expense.id === id)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load transactions')
      } finally {
        setLoading(false)
      }
    },
    [accountId, duplicates, hasReceipt, maxAmount, merchant, minAmount, reviewStatus, tag, uncategorized],
  )

  const refreshCurrentPage = useCallback(
    () => fetchData(page, start, end, category, source),
    [category, end, fetchData, page, source, start],
  )

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {})
    getAccounts().then((res) => setAccounts(res.accounts)).catch(() => {})
    getTags().then((res) => setAllTags(res.tags)).catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qsStart = params.get('start')
    if (qsStart) setStart(qsStart)
    const qsEnd = params.get('end')
    if (qsEnd) setEnd(qsEnd)
    const qsReview = params.get('review_status')
    if (qsReview) setReviewStatus(qsReview)
    const qsReceipt = params.get('has_receipt')
    if (qsReceipt === 'true') setHasReceipt('yes')
    if (qsReceipt === 'false') setHasReceipt('no')
    if (params.get('uncategorized') === 'true') setUncategorized(true)
    if (params.get('duplicates') === 'true') setDuplicates(true)
    const qsTag = params.get('tag')
    if (qsTag) setTag(qsTag)
    const qsMerchant = params.get('merchant')
    if (qsMerchant) setMerchant(qsMerchant)
    const qsAccount = params.get('account_id')
    if (qsAccount) setAccountId(qsAccount)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchData(1, start, end, category, source), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [start, end, category, source, merchant, minAmount, maxAmount, tag, uncategorized, hasReceipt, reviewStatus, duplicates, accountId, fetchData])

  const mergeOptions = useMemo(
    () => (mergeCandidates.length > 0 ? mergeCandidates : expenses.filter((expense) => expense.id !== mergeTarget?.id)),
    [expenses, mergeCandidates, mergeTarget],
  )

  function goPage(p: number) {
    void fetchData(p, start, end, category, source)
    window.scrollTo(0, 0)
  }

  function openEdit(expense: Expense) {
    setMutationError(null)
    setEditing(expense)
    setDraft(makeDraft(expense))
  }

  function openMerge(expense: Expense) {
    setMutationError(null)
    setMergeTarget(expense)
    setMergeDuplicateId('')
    setMergeCandidates([])
    getDuplicateCandidates(expense.id)
      .then((res) => setMergeCandidates(res.candidates))
      .catch(() => setMergeCandidates([]))
  }

  function toggleSelected(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id]))
  }

  function tagNames(raw: string) {
    return raw
      .split(/[,;]+/)
      .map((name) => name.trim())
      .filter(Boolean)
  }

  async function syncTags(expense: Expense, desiredRaw: string) {
    const desired = tagNames(desiredRaw).map((name) => name.toLowerCase().replace(/\s+/g, ' '))
    const current = expense.tags.map((name) => name.toLowerCase())
    await Promise.all(desired.filter((name) => !current.includes(name)).map((name) => addExpenseTag(expense.id, name)))
    const byName = new Map(allTags.map((item) => [item.name.toLowerCase(), item.id]))
    await Promise.all(
      current
        .filter((name) => !desired.includes(name))
        .map((name) => byName.get(name))
        .filter((id): id is string => !!id)
        .map((id) => removeExpenseTag(expense.id, id)),
    )
  }

  async function saveCreate() {
    const amountCents = parseAmountCents(createDraft.amount)
    if (!amountCents) {
      setMutationError('Enter a valid amount greater than zero.')
      return
    }
    if (!createDraft.date) {
      setMutationError('Choose a transaction date.')
      return
    }
    if (!createDraft.merchant.trim() && !createDraft.description.trim()) {
      setMutationError('Enter a merchant or description.')
      return
    }

    setBusyId('create')
    setMutationError(null)
    try {
      await createExpense({
        amount_cents: amountCents,
        currency: 'INR',
        description: createDraft.description.trim() || null,
        merchant: createDraft.merchant.trim() || null,
        category_id: createDraft.categoryId || null,
        account_id: createDraft.accountId || null,
        occurred_at: createDraft.date,
        review_status: createDraft.reviewStatus,
        tag_names: tagNames(createDraft.tags),
      })
      setCreating(false)
      setCreateDraft(makeCreateDraft())
      await refreshCurrentPage()
      getTags().then((res) => setAllTags(res.tags)).catch(() => {})
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to create transaction')
    } finally {
      setBusyId(null)
    }
  }

  async function saveEdit() {
    if (!editing || !draft) return
    const amountCents = parseAmountCents(draft.amount)
    if (!amountCents) {
      setMutationError('Enter a valid amount greater than zero.')
      return
    }
    if (!draft.date) {
      setMutationError('Choose a transaction date.')
      return
    }

    setBusyId(editing.id)
    setMutationError(null)
    try {
      await updateExpense(editing.id, {
        amount_cents: amountCents,
        currency: editing.currency,
        description: draft.description.trim() || null,
        merchant: draft.merchant.trim() || null,
        category_id: draft.categoryId || null,
        account_id: draft.accountId || null,
        occurred_at: draft.date,
        review_status: draft.reviewStatus,
      })
      await syncTags(editing, draft.tags)
      getTags().then((res) => setAllTags(res.tags)).catch(() => {})
      await refreshCurrentPage()
      setEditing(null)
      setDraft(null)
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to save transaction')
    } finally {
      setBusyId(null)
    }
  }

  async function removeExpense(expense: Expense) {
    if (!window.confirm(`Delete ${expenseTitle(expense)} for ${formatCents(expense.amount_cents, expense.currency)}?`)) {
      return
    }
    setBusyId(expense.id)
    setMutationError(null)
    try {
      await deleteExpense(expense.id)
      if (expenses.length === 1 && page > 1) {
        goPage(page - 1)
      } else {
        await refreshCurrentPage()
      }
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to delete transaction')
    } finally {
      setBusyId(null)
    }
  }

  async function mergeSelected() {
    if (!mergeTarget || !mergeDuplicateId) return
    setBusyId(mergeTarget.id)
    setMutationError(null)
    try {
      await mergeExpense(mergeTarget.id, mergeDuplicateId)
      await refreshCurrentPage()
      setMergeTarget(null)
      setMergeDuplicateId('')
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to merge transactions')
    } finally {
      setBusyId(null)
    }
  }

  async function applyBulkCorrection() {
    if (selectedIds.length === 0) return
    setBusyId('bulk')
    setMutationError(null)
    try {
      await bulkUpdateExpenses({
        ids: selectedIds,
        category_id: bulkCategoryId === 'null' ? null : bulkCategoryId || undefined,
        account_id: bulkAccountId === 'null' ? null : bulkAccountId || undefined,
        tag_names: tagNames(bulkTags),
        review_status: bulkReviewStatus ? (bulkReviewStatus as 'needs_review' | 'reviewed' | 'ignored') : undefined,
      })
      setSelectedIds([])
      setBulkTags('')
      setBulkAccountId('')
      await refreshCurrentPage()
      getTags().then((res) => setAllTags(res.tags)).catch(() => {})
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to update selected transactions')
    } finally {
      setBusyId(null)
    }
  }

  async function uploadReceipt(expense: Expense, file: File | undefined) {
    if (!file) return
    setBusyId(expense.id)
    setMutationError(null)
    try {
      await attachReceipt(expense.id, file)
      await refreshCurrentPage()
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to attach receipt')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Transactions</h2>
        <div className="toolbar-inline">
          <button type="button" className="button-primary" onClick={() => { setCreateDraft(makeCreateDraft()); setCreating(true); setMutationError(null) }}>
            Add Transaction
          </button>
          <a
            href={(() => {
              const now = new Date()
              return withLedgerParam(`/api/export/xlsx?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
            })()}
            download
            className="button-primary"
            title="Download this month as .xlsx"
          >
            Download Excel
          </a>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <div>
            <label>From</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div>
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Merchant</label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Search merchant" />
          </div>
          <div>
            <label>Min</label>
            <input inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="Amount" />
          </div>
          <div>
            <label>Max</label>
            <input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="Amount" />
          </div>
          <div>
            <label>Tag</label>
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag" />
          </div>
          <div>
            <label>Receipt</label>
            <select value={hasReceipt} onChange={(e) => setHasReceipt(e.target.value)}>
              <option value="">Any</option>
              <option value="yes">Has receipt</option>
              <option value="no">Missing receipt</option>
            </select>
          </div>
          <div>
            <label>Review</label>
            <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="needs_review">Needs review</option>
              <option value="reviewed">Reviewed</option>
              <option value="ignored">Ignored</option>
            </select>
          </div>
          <label className="check-inline">
            <input type="checkbox" checked={uncategorized} onChange={(e) => setUncategorized(e.target.checked)} />
            Uncategorized
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} />
            Duplicates
          </label>
          <fieldset className="segmented-field">
            <legend>Source</legend>
            {SOURCE_OPTIONS.map((opt) => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name="source"
                  value={opt.value}
                  checked={source === opt.value}
                  onChange={() => setSource(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {mutationError && <div className="error-msg">{mutationError}</div>}
        {selectedIds.length > 0 ? (
          <div className="bulk-bar">
            <strong>{selectedIds.length} selected</strong>
            <select value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
              <option value="">Keep category</option>
              <option value="null">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={bulkAccountId} onChange={(e) => setBulkAccountId(e.target.value)}>
              <option value="">Keep account</option>
              <option value="null">No account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
            <input value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} placeholder="Add tags" />
            <select value={bulkReviewStatus} onChange={(e) => setBulkReviewStatus(e.target.value)}>
              <option value="">Keep review</option>
              <option value="needs_review">Needs review</option>
              <option value="reviewed">Reviewed</option>
              <option value="ignored">Ignored</option>
            </select>
            <button type="button" className="button-primary" onClick={() => void applyBulkCorrection()} disabled={busyId === 'bulk'}>
              Apply
            </button>
            <button type="button" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        ) : null}

        {loading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 40, marginBottom: 6, borderRadius: 6 }} />
            ))}
          </div>
        ) : (
          <>
            <p className="table-count">
              {total} transaction{total !== 1 ? 's' : ''}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        aria-label="Select all transactions"
                        type="checkbox"
                        checked={expenses.length > 0 && selectedIds.length === expenses.length}
                        onChange={(e) => setSelectedIds(e.target.checked ? expenses.map((expense) => expense.id) : [])}
                      />
                    </th>
                    <th>Date</th>
                    <th>Merchant / Description</th>
                    <th>Category</th>
                    <th>Account</th>
                    <th>Source</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Tags</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>
                          <input
                            aria-label={`Select ${expenseTitle(expense)}`}
                            type="checkbox"
                            checked={selectedIds.includes(expense.id)}
                            onChange={() => toggleSelected(expense.id)}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(expense.occurred_at)}</td>
                        <td>
                          <strong className="transaction-title">{expenseTitle(expense)}</strong>
                          {expense.merchant && expense.description ? (
                            <span className="transaction-subtitle">{expense.description}</span>
                          ) : null}
                        </td>
                        <td>{expense.category ?? 'Uncategorized'}</td>
                        <td>{expense.account ?? '—'}</td>
                        <td>
                          <span className={sourceBadgeClass(expense.source)}>
                            {sourceBadgeLabel(expense.source)}
                          </span>
                          {expense.review_status === 'needs_review' ? <span className="badge badge-review">review</span> : null}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatCents(expense.amount_cents, expense.currency)}
                        </td>
                        <td>
                          <span className="tag-cloud inline-tags">
                            {expense.tags.length === 0 ? '—' : expense.tags.map((name) => <span key={name}>#{name}</span>)}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" onClick={() => openEdit(expense)} disabled={busyId === expense.id}>
                              Edit
                            </button>
                            <button type="button" onClick={() => openMerge(expense)} disabled={busyId === expense.id}>
                              Merge
                            </button>
                            <label className="file-button">
                              {expense.image_key ? 'Replace receipt' : 'Attach receipt'}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => void uploadReceipt(expense, e.target.files?.[0])}
                                disabled={busyId === expense.id}
                              />
                            </label>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => void removeExpense(expense)}
                              disabled={busyId === expense.id}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button onClick={() => goPage(page - 1)} disabled={page <= 1}>Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button onClick={() => goPage(page + 1)} disabled={page >= totalPages}>Next</button>
            </div>
          </>
        )}
      </div>

      {creating ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-transaction-title">
          <div className="modal transaction-modal">
            <button className="close-btn" type="button" onClick={() => setCreating(false)}>x</button>
            <h3 id="add-transaction-title">Add Transaction</h3>
            <div className="form-grid">
              <label>
                Amount
                <input
                  inputMode="decimal"
                  value={createDraft.amount}
                  onChange={(e) => setCreateDraft({ ...createDraft, amount: e.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={createDraft.date}
                  onChange={(e) => setCreateDraft({ ...createDraft, date: e.target.value })}
                />
              </label>
              <label>
                Merchant
                <input
                  value={createDraft.merchant}
                  onChange={(e) => setCreateDraft({ ...createDraft, merchant: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={createDraft.categoryId}
                  onChange={(e) => setCreateDraft({ ...createDraft, categoryId: e.target.value })}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Account
                <select
                  value={createDraft.accountId}
                  onChange={(e) => setCreateDraft({ ...createDraft, accountId: e.target.value })}
                >
                  <option value="">No account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Review
                <select
                  value={createDraft.reviewStatus}
                  onChange={(e) => setCreateDraft({ ...createDraft, reviewStatus: e.target.value as EditDraft['reviewStatus'] })}
                >
                  <option value="needs_review">Needs review</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="ignored">Ignored</option>
                </select>
              </label>
              <label className="form-span">
                Description
                <textarea
                  value={createDraft.description}
                  onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
                  rows={3}
                />
              </label>
              <label className="form-span">
                Tags
                <input
                  value={createDraft.tags}
                  onChange={(e) => setCreateDraft({ ...createDraft, tags: e.target.value })}
                  placeholder="cash, lunch"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setCreating(false)}>Cancel</button>
              <button type="button" className="button-primary" onClick={() => void saveCreate()} disabled={busyId === 'create'}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing && draft ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title">
          <div className="modal transaction-modal">
            <button className="close-btn" type="button" onClick={() => setEditing(null)}>x</button>
            <h3 id="edit-transaction-title">Edit Transaction</h3>
            <div className="form-grid">
              <label>
                Amount
                <input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <label>
                Merchant
                <input
                  value={draft.merchant}
                  onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Account
                <select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">No account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Review
                <select
                  value={draft.reviewStatus}
                  onChange={(e) => setDraft({ ...draft, reviewStatus: e.target.value as EditDraft['reviewStatus'] })}
                >
                  <option value="needs_review">Needs review</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="ignored">Ignored</option>
                </select>
              </label>
              <label className="form-span">
                Description
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={3}
                />
              </label>
              <label className="form-span">
                Tags
                <input
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  placeholder="work, lunch"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="button-primary" onClick={() => void saveEdit()} disabled={busyId === editing.id}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeTarget ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="merge-transaction-title">
          <div className="modal transaction-modal">
            <button className="close-btn" type="button" onClick={() => setMergeTarget(null)}>x</button>
            <h3 id="merge-transaction-title">Merge Duplicate</h3>
            <div className="merge-summary">
              <span>Keep</span>
              <strong>{expenseTitle(mergeTarget)}</strong>
              <span>{formatCents(mergeTarget.amount_cents, mergeTarget.currency)} on {formatDate(mergeTarget.occurred_at)}</span>
            </div>
            <label className="merge-select">
              Duplicate to remove
              <select value={mergeDuplicateId} onChange={(e) => setMergeDuplicateId(e.target.value)}>
                <option value="">Select a transaction</option>
                {mergeOptions.map((expense) => (
                  <option key={expense.id} value={expense.id}>
                    {formatDate(expense.occurred_at)} - {expenseTitle(expense)} - {formatCents(expense.amount_cents, expense.currency)}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setMergeTarget(null)}>Cancel</button>
              <button
                type="button"
                className="button-primary"
                onClick={() => void mergeSelected()}
                disabled={!mergeDuplicateId || busyId === mergeTarget.id}
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
