'use client'

import { useEffect, useState } from 'react'
import { getReceipts, formatCents, formatDate, type Receipt } from '../../../lib/api'

function ReceiptModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close">×</button>
        <img src={receipt.receipt_url} alt={receipt.merchant ?? 'Receipt'} />
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem', fontSize: '0.9rem' }}>
          <dt style={{ color: '#6b7280' }}>Merchant</dt>
          <dd style={{ fontWeight: 600 }}>{receipt.merchant ?? '—'}</dd>
          <dt style={{ color: '#6b7280' }}>Amount</dt>
          <dd style={{ fontWeight: 700, color: '#7c3aed' }}>{formatCents(receipt.amount_cents, receipt.currency)}</dd>
          <dt style={{ color: '#6b7280' }}>Date</dt>
          <dd>{formatDate(receipt.occurred_at)}</dd>
          <dt style={{ color: '#6b7280' }}>Category</dt>
          <dd>{receipt.category ?? '—'}</dd>
          {receipt.description && (
            <>
              <dt style={{ color: '#6b7280' }}>Notes</dt>
              <dd>{receipt.description}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Receipt | null>(null)

  function fetchPage(p: number) {
    setLoading(true)
    setError(null)
    getReceipts({ page: p, limit: 24 })
      .then((res) => {
        setReceipts(res.data)
        setTotal(res.total)
        setPage(res.page)
        setTotalPages(res.totalPages)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchPage(1)
  }, [])

  return (
    <div className="page">
      <h2 style={{ marginBottom: '1.25rem', fontSize: '1.3rem' }}>Receipts</h2>

      {error && <div className="error-msg">{error}</div>}

      {loading ? (
        <div className="receipt-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 220, borderRadius: 10 }} />
          ))}
        </div>
      ) : (
        <>
          <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '1rem' }}>
            {total} receipt{total !== 1 ? 's' : ''}
          </p>
          {receipts.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No receipts found.</p>
          ) : (
            <div className="receipt-grid">
              {receipts.map((r) => (
                <div
                  key={r.id}
                  className="receipt-card"
                  onClick={() => setSelected(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(r)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.receipt_url} alt={r.merchant ?? 'Receipt'} />
                  <div className="info">
                    <div className="merchant">{r.merchant ?? '—'}</div>
                    <div className="amount">{formatCents(r.amount_cents, r.currency)}</div>
                    <div className="date">{formatDate(r.occurred_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pagination">
            <button onClick={() => { fetchPage(page - 1); window.scrollTo(0, 0) }} disabled={page <= 1}>← Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => { fetchPage(page + 1); window.scrollTo(0, 0) }} disabled={page >= totalPages}>Next →</button>
          </div>
        </>
      )}

      {selected && <ReceiptModal receipt={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
