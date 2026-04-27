'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  getExpenses,
  getCategories,
  formatCents,
  formatDate,
  type Expense,
  type Category,
} from '../../../lib/api'

const SOURCE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Bot', value: 'bot' },
  { label: 'Statement', value: 'statement' },
  { label: 'Receipt', value: 'receipt' },
]

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

export default function TransactionsPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(
    (p: number, st: string, en: string, cat: string, src: string) => {
      setLoading(true)
      setError(null)
      getExpenses({ page: p, limit: 20, start: st, end: en, category: cat, source: src })
        .then((res) => {
          setExpenses(res.data)
          setTotal(res.total)
          setPage(res.page)
          setTotalPages(res.totalPages)
          setLoading(false)
        })
        .catch((e: Error) => {
          setError(e.message)
          setLoading(false)
        })
    },
    [],
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

  function goPage(p: number) {
    fetchData(p, start, end, category, source)
    window.scrollTo(0, 0)
  }

  return (
    <div className="page">
      <h2 style={{ marginBottom: '1.25rem', fontSize: '1.3rem' }}>Transactions</h2>

      <div className="card">
        <div className="filter-bar">
          <div>
            <label>From</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ marginLeft: 6 }} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ marginLeft: 6 }} />
          </div>
          <div>
            <label style={{ marginRight: 6 }}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <label>Source</label>
            {SOURCE_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
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
          </div>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {loading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 40, marginBottom: 6, borderRadius: 6 }} />
            ))}
          </div>
        ) : (
          <>
            <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
              {total} transaction{total !== 1 ? 's' : ''}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant / Description</th>
                  <th>Category</th>
                  <th>Source</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>
                      No transactions found.
                    </td>
                  </tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.occurred_at)}</td>
                      <td>{e.merchant ?? e.description ?? '—'}</td>
                      <td>{e.category ?? '—'}</td>
                      <td>
                        <span className={sourceBadgeClass(e.source)}>
                          {sourceBadgeLabel(e.source)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {formatCents(e.amount_cents, e.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="pagination">
              <button onClick={() => goPage(page - 1)} disabled={page <= 1}>← Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button onClick={() => goPage(page + 1)} disabled={page >= totalPages}>Next →</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
