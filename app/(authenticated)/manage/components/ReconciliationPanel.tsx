'use client'

import { formatCents, formatDate, type Account, type ReconciliationResult } from '../../../../lib/api'

export default function ReconciliationPanel({
  month,
  accounts,
  reconcileAccount,
  reconciliation,
  busy,
  onSetMonth,
  onSetReconcileAccount,
  onRefresh,
}: {
  month: string
  accounts: Account[]
  reconcileAccount: string
  reconciliation: ReconciliationResult | null
  busy: boolean
  onSetMonth: (value: string) => void
  onSetReconcileAccount: (value: string) => void
  onRefresh: () => Promise<void>
}) {
  return (
    <section className="card workspace-card wide-card">
      <h3>Monthly Reconciliation</h3>
      <div className="inline-form">
        <input type="month" value={month} onChange={(e) => onSetMonth(e.target.value)} />
        <select value={reconcileAccount} onChange={(e) => onSetReconcileAccount(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => void onRefresh()} disabled={busy}>Refresh</button>
      </div>
      {reconciliation ? (
        <>
          <div className="summary-grid compact-summary">
            <span><strong>{reconciliation.summary.matched_count}</strong><small>matched</small></span>
            <span><strong>{reconciliation.summary.missing_in_khata}</strong><small>missing in Khata</small></span>
            <span><strong>{reconciliation.summary.missing_in_statement}</strong><small>missing in statement</small></span>
            <span><strong>{reconciliation.summary.amount_mismatch}</strong><small>amount mismatch</small></span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th style={{ textAlign: 'right' }}>Khata</th>
                  <th style={{ textAlign: 'right' }}>Statement</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.items.slice(0, 20).map((item) => (
                  <tr key={`${item.status}-${item.expense_id ?? item.statement_row_id}`}>
                    <td><span className={`badge badge-${item.status}`}>{item.status.replace(/_/g, ' ')}</span></td>
                    <td>{formatDate(item.occurred_at)}</td>
                    <td>{item.description}</td>
                    <td>{item.account ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatCents(item.amount_cents, item.currency)}</td>
                    <td style={{ textAlign: 'right' }}>{item.statement_amount_cents ? formatCents(item.statement_amount_cents, item.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p>No reconciliation loaded.</p>}
    </section>
  )
}
