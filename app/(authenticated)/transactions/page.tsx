'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteExpense,
  formatCents,
  formatDate,
  getCategories,
  getExpenses,
  mergeExpense,
  updateExpense,
  type Category,
  type Expense,
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
  }
}

export default function TransactionsPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
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

  const [editing, setEditing] = useState<Expense | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [mergeTarget, setMergeTarget] = useState<Expense | null>(null)
  const [mergeDuplicateId, setMergeDuplicateId] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(
    async (p: number, st: string, en: string, cat: string, src: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await getExpenses({ page: p, limit: 20, start: st, end: en, category: cat, source: src })
        setExpenses(res.data)
        setTotal(res.total)
        setPage(res.page)
        setTotalPages(res.totalPages)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load transactions')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const refreshCurrentPage = useCallback(
    () => fetchData(page, start, end, category, source),
    [category, end, fetchData, page, source, start],
  )

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchData(1, start, end, category, source), 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [start, end, category, source, fetchData])

  const mergeOptions = useMemo(
    () => expenses.filter((expense) => expense.id !== mergeTarget?.id),
    [expenses, mergeTarget],
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
        occurred_at: draft.date,
      })
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

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Transactions</h2>
        <a
          href={(() => {
            const now = new Date()
            return `/api/export/xlsx?year=${now.getFullYear()}&month=${now.getMonth() + 1}`
          })()}
          download
          className="button-primary"
          title="Download this month as .xlsx"
        >
          Download Excel
        </a>
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
                    <th>Date</th>
                    <th>Merchant / Description</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((expense) => (
                      <tr key={expense.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(expense.occurred_at)}</td>
                        <td>
                          <strong className="transaction-title">{expenseTitle(expense)}</strong>
                          {expense.merchant && expense.description ? (
                            <span className="transaction-subtitle">{expense.description}</span>
                          ) : null}
                        </td>
                        <td>{expense.category ?? 'Uncategorized'}</td>
                        <td>
                          <span className={sourceBadgeClass(expense.source)}>
                            {sourceBadgeLabel(expense.source)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {formatCents(expense.amount_cents, expense.currency)}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" onClick={() => openEdit(expense)} disabled={busyId === expense.id}>
                              Edit
                            </button>
                            <button type="button" onClick={() => openMerge(expense)} disabled={expenses.length < 2}>
                              Merge
                            </button>
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
              <label className="form-span">
                Description
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={3}
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
