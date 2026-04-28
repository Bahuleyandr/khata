'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  formatCents,
  formatDate,
  getCategories,
  getReceipts,
  updateExpense,
  type Category,
  type Receipt,
} from '../../../lib/api'

type ReceiptDraft = {
  amount: string
  date: string
  merchant: string
  description: string
  categoryId: string
}

function receiptTitle(receipt: Receipt) {
  return receipt.merchant ?? receipt.description ?? 'Untitled receipt'
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

function makeDraft(receipt: Receipt): ReceiptDraft {
  return {
    amount: centsToAmountInput(receipt.amount_cents),
    date: dateInputValue(receipt.occurred_at),
    merchant: receipt.merchant ?? '',
    description: receipt.description ?? '',
    categoryId: receipt.category_id ?? '',
  }
}

function ReceiptModal({
  receipt,
  draft,
  categories,
  busy,
  error,
  position,
  total,
  hasPrevious,
  hasNext,
  onDraftChange,
  onSave,
  onSaveAndNext,
  onPrevious,
  onNext,
  onClose,
}: {
  receipt: Receipt
  draft: ReceiptDraft
  categories: Category[]
  busy: boolean
  error: string | null
  position: number
  total: number
  hasPrevious: boolean
  hasNext: boolean
  onDraftChange: (draft: ReceiptDraft) => void
  onSave: () => void
  onSaveAndNext: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal receipt-review-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-review-title"
      >
        <button className="close-btn" type="button" onClick={onClose} aria-label="Close">x</button>
        <h3 id="receipt-review-title">Review Receipt</h3>
        {error ? <div className="error-msg">{error}</div> : null}
        <div className="receipt-review-toolbar">
          <span>Receipt {position} of {total}</span>
          <div>
            <button type="button" onClick={onPrevious} disabled={!hasPrevious || busy}>Previous</button>
            <button type="button" onClick={onNext} disabled={!hasNext || busy}>Next</button>
          </div>
        </div>
        <div className="receipt-review-layout">
          <div className="receipt-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt.receipt_url} alt={receiptTitle(receipt)} />
          </div>
          <div className="receipt-review-panel">
            <div className="receipt-summary">
              <strong>{receiptTitle(receipt)}</strong>
              <span>{formatCents(receipt.amount_cents, receipt.currency)} on {formatDate(receipt.occurred_at)}</span>
              {receipt.review_status === 'needs_review' ? <span className="badge badge-review">Needs review</span> : null}
            </div>
            <div className="form-grid">
              <label>
                Amount
                <input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => onDraftChange({ ...draft, amount: e.target.value })}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => onDraftChange({ ...draft, date: e.target.value })}
                />
              </label>
              <label>
                Merchant
                <input
                  value={draft.merchant}
                  onChange={(e) => onDraftChange({ ...draft, merchant: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={draft.categoryId}
                  onChange={(e) => onDraftChange({ ...draft, categoryId: e.target.value })}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="form-span">
                Notes
                <textarea
                  value={draft.description}
                  onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
                  rows={4}
                />
              </label>
            </div>
            <details className="raw-text-panel">
              <summary>OCR text</summary>
              <pre>{receipt.raw_text?.trim() || 'No OCR text stored for this receipt.'}</pre>
            </details>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Done</button>
              {hasNext ? (
                <button type="button" onClick={onSaveAndNext} disabled={busy}>
                  Save & Next
                </button>
              ) : null}
              <button type="button" className="button-primary" onClick={onSave} disabled={busy}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Receipt | null>(null)
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchPage = useCallback((p: number) => {
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
  }, [])

  useEffect(() => {
    fetchPage(1)
  }, [fetchPage])

  useEffect(() => {
    let active = true
    getCategories()
      .then((rows) => {
        if (active) setCategories(rows)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  function openReceipt(receipt: Receipt) {
    setSelected(receipt)
    setDraft(makeDraft(receipt))
    setMutationError(null)
  }

  function selectedIndex() {
    if (!selected) return -1
    return receipts.findIndex((receipt) => receipt.id === selected.id)
  }

  function openReceiptAt(index: number) {
    const receipt = receipts[index]
    if (!receipt) return
    openReceipt(receipt)
  }

  function closeReceipt() {
    setSelected(null)
    setDraft(null)
    setMutationError(null)
  }

  async function saveReceipt(): Promise<boolean> {
    if (!selected || !draft) return false
    const amountCents = parseAmountCents(draft.amount)
    if (!amountCents || amountCents <= 0) {
      setMutationError('Enter a valid amount greater than zero.')
      return false
    }
    if (!draft.date) {
      setMutationError('Choose a receipt date.')
      return false
    }

    setBusyId(selected.id)
    setMutationError(null)
    try {
      const updated = await updateExpense(selected.id, {
        amount_cents: amountCents,
        currency: selected.currency,
        description: draft.description.trim() || null,
        merchant: draft.merchant.trim() || null,
        category_id: draft.categoryId || null,
        occurred_at: draft.date,
        review_status: 'reviewed',
      })
      const nextReceipt: Receipt = {
        ...selected,
        amount_cents: updated.amount_cents,
        currency: updated.currency,
        description: updated.description,
        merchant: updated.merchant,
        category_id: updated.category_id,
        category: updated.category,
        occurred_at: updated.occurred_at,
        image_key: updated.image_key ?? selected.image_key,
      }
      setReceipts((rows) => rows.map((row) => (row.id === nextReceipt.id ? nextReceipt : row)))
      setSelected(nextReceipt)
      setDraft(makeDraft(nextReceipt))
      return true
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : 'Failed to save receipt')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function saveReceiptAndNext() {
    const currentIndex = selectedIndex()
    const saved = await saveReceipt()
    if (saved && currentIndex >= 0) {
      openReceiptAt(currentIndex + 1)
    }
  }

  function goPage(p: number) {
    fetchPage(p)
    window.scrollTo(0, 0)
  }

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
              {receipts.map((receipt) => (
                <button
                  key={receipt.id}
                  className="receipt-card"
                  onClick={() => openReceipt(receipt)}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={receipt.receipt_url} alt={receiptTitle(receipt)} />
                  <span className="info">
                    <span className="merchant">{receiptTitle(receipt)}</span>
                    <span className="amount">{formatCents(receipt.amount_cents, receipt.currency)}</span>
                    <span className="date">{formatDate(receipt.occurred_at)} - {receipt.category ?? 'Uncategorized'}</span>
                    {receipt.review_status === 'needs_review' ? <span className="date">Needs review</span> : null}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="pagination">
            <button onClick={() => goPage(page - 1)} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => goPage(page + 1)} disabled={page >= totalPages}>Next</button>
          </div>
        </>
      )}

      {selected && draft ? (
        <ReceiptModal
          receipt={selected}
          draft={draft}
          categories={categories}
          busy={busyId === selected.id}
          error={mutationError}
          position={selectedIndex() + 1}
          total={receipts.length}
          hasPrevious={selectedIndex() > 0}
          hasNext={selectedIndex() >= 0 && selectedIndex() < receipts.length - 1}
          onDraftChange={setDraft}
          onSave={() => void saveReceipt()}
          onSaveAndNext={() => void saveReceiptAndNext()}
          onPrevious={() => openReceiptAt(selectedIndex() - 1)}
          onNext={() => openReceiptAt(selectedIndex() + 1)}
          onClose={closeReceipt}
        />
      ) : null}
    </div>
  )
}
