'use client'

import { useEffect, useState } from 'react'
import {
  formatCents,
  formatDate,
  getStatementRows,
  importStatementRows,
  retryStatement,
  updateStatementImportRow,
  uploadStatement,
  type Account,
  type Category,
  type StatementImport,
  type StatementImportRow,
} from '../../../../lib/api'
import { parseTagNames } from './helpers'

function StatementRowCorrection({
  row,
  categories,
  accounts,
  busy,
  onSave,
}: {
  row: StatementImportRow
  categories: Category[]
  accounts: Account[]
  busy: boolean
  onSave: (data: { category_id: string | null; account_id: string | null; tag_names: string[] }) => Promise<boolean>
}) {
  const [categoryId, setCategoryId] = useState(row.category_id ?? '')
  const [accountId, setAccountId] = useState(row.account_id ?? '')
  const [tagText, setTagText] = useState(row.tag_names.join(', '))

  useEffect(() => {
    setCategoryId(row.category_id ?? '')
    setAccountId(row.account_id ?? '')
    setTagText(row.tag_names.join(', '))
  }, [row.account_id, row.category_id, row.tag_names])

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
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        disabled={busy}
        aria-label={`Account for ${row.description}`}
      >
        <option value="">No account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
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
        onClick={() => void onSave({ category_id: categoryId || null, account_id: accountId || null, tag_names: parseTagNames(tagText) })}
        disabled={busy}
      >
        Save
      </button>
    </div>
  )
}

export default function StatementImportsPanel({
  statements,
  categories,
  accounts,
  busy,
  onRun,
  onError,
}: {
  statements: StatementImport[]
  categories: Category[]
  accounts: Account[]
  busy: boolean
  onRun: (action: () => Promise<void>) => Promise<boolean>
  onError: (msg: string) => void
}) {
  // Statement row state is owned locally (loaded on-demand, not in refresh())
  const [statementRows, setStatementRows] = useState<StatementImportRow[]>([])
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [selectedStatementRowIds, setSelectedStatementRowIds] = useState<string[]>([])
  const [bulkStatementCategory, setBulkStatementCategory] = useState('')
  const [bulkStatementAccount, setBulkStatementAccount] = useState('')
  const [bulkStatementTags, setBulkStatementTags] = useState('')
  const [statementAccount, setStatementAccount] = useState('')
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [statementInputKey, setStatementInputKey] = useState(0)
  const [statementUploadResult, setStatementUploadResult] = useState<string | null>(null)

  const pendingStatementRows = statementRows.filter((row) => row.status === 'pending')
  const selectedPendingRowIds = selectedStatementRowIds.filter((id) =>
    pendingStatementRows.some((row) => row.id === id),
  )

  // loadStatementReview loads rows into panel-local state (not coordinator data).
  // It is called via run() (matching original) so it sets busy, surfaces errors via the
  // coordinator error banner, and calls refresh() after (which updates imported_count badge).
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
    data: { category_id: string | null; account_id?: string | null; tag_names: string[] },
  ) {
    if (!selectedStatementId) return
    await updateStatementImportRow(selectedStatementId, rowId, data)
    await loadStatementReview(selectedStatementId)
  }

  async function applyCorrectionsToSelected() {
    if (!selectedStatementId || selectedPendingRowIds.length === 0) return
    const body: { category_id?: string | null; account_id?: string | null; tag_names?: string[] } = {}
    if (bulkStatementCategory === '__none__') body.category_id = null
    else if (bulkStatementCategory) body.category_id = bulkStatementCategory
    if (bulkStatementAccount === '__none__') body.account_id = null
    else if (bulkStatementAccount) body.account_id = bulkStatementAccount
    if (bulkStatementTags.trim()) body.tag_names = parseTagNames(bulkStatementTags)
    if (!Object.keys(body).length) {
      throw new Error('Choose a category, account, or enter tags to apply.')
    }
    await Promise.all(
      selectedPendingRowIds.map((rowId) => updateStatementImportRow(selectedStatementId, rowId, body)),
    )
    setBulkStatementCategory('')
    setBulkStatementAccount('')
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

  async function uploadSelectedStatement() {
    if (!statementFile) {
      onError('Choose a PDF or statement image first.')
      return
    }
    const result = await uploadStatement(statementFile, statementAccount || undefined)
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
        <select
          value={statementAccount}
          onChange={(e) => setStatementAccount(e.target.value)}
          aria-label="Statement account"
        >
          <option value="">Detect account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="button-primary"
          onClick={() => void onRun(uploadSelectedStatement)}
          disabled={busy || !statementFile}
        >
          Upload
        </button>
        {statementUploadResult ? <span>{statementUploadResult}</span> : null}
      </div>
      <small className="disclosure-note">
        Statement contents (including account and card numbers) are sent to MiniMax for
        transaction extraction.
      </small>
      <div className="statement-list">
        {statements.length === 0 ? <p>No statement imports yet.</p> : statements.map((statement) => (
          <div key={statement.id} className="statement-row">
            <div>
              <strong>{statement.status}</strong>
              <span>
                {statement.parsed_count} parsed · {statement.imported_count} imported · {statement.duplicate_count} duplicates
              </span>
              {statement.error_reason ? <small>{statement.error_reason}</small> : null}
              {statement.account ? <small>Account: {statement.account}</small> : null}
            </div>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => void onRun(() => loadStatementReview(statement.id))}
                disabled={busy}
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => void onRun(() => reparseStatement(statement.id))}
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
                onClick={() => void onRun(() => importSelectedRows(selectedPendingRowIds))}
                disabled={busy || selectedPendingRowIds.length === 0}
              >
                Import selected
              </button>
              <button
                type="button"
                onClick={() => void onRun(() => importSelectedRows())}
                disabled={busy || pendingStatementRows.length === 0}
              >
                Import all
              </button>
              <button
                type="button"
                onClick={() => void onRun(ignoreSelectedRows)}
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
            <select
              value={bulkStatementAccount}
              onChange={(e) => setBulkStatementAccount(e.target.value)}
              aria-label="Bulk statement account"
            >
              <option value="">Keep account</option>
              <option value="__none__">No account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void onRun(applyCorrectionsToSelected)}
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
                  <th>Account</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.length === 0 ? (
                  <tr><td colSpan={10}>No parsed rows for this statement.</td></tr>
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
                    <td data-label="Account">{row.account ?? '—'}</td>
                    <td data-label="Tags">{row.tag_names.length ? row.tag_names.map((tag) => `#${tag}`).join(' ') : '—'}</td>
                    <td data-label="Status"><span className={`badge badge-${row.status}`}>{row.status}</span></td>
                    <td data-label="Amount" style={{ textAlign: 'right', fontWeight: 600 }}>{formatCents(row.amount_cents, row.currency)}</td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        {row.status === 'pending' ? (
                          <StatementRowCorrection
                            row={row}
                            categories={categories}
                            accounts={accounts}
                            busy={busy}
                            onSave={(data) => onRun(() => saveStatementRowCorrection(row.id, data))}
                          />
                        ) : null}
                        {row.status === 'ignored' ? (
                          <button
                            type="button"
                            onClick={() => void onRun(() => restoreStatementRow(row.id))}
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
  )
}
