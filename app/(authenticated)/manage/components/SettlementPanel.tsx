'use client'

import { formatCents, type HouseholdSettlement, type Me } from '../../../../lib/api'

export default function SettlementPanel({
  me,
  settlement,
}: {
  me: Me | null
  settlement: HouseholdSettlement | null
}) {
  return (
    <section className="card workspace-card">
      <h3>Household Settlement</h3>
      {me?.selected_ledger_kind !== 'household' ? (
        <p className="muted-copy">Switch to the Household ledger to see shared settlement.</p>
      ) : settlement ? (
        <>
          <div className="summary-grid compact-summary">
            <span><strong>{formatCents(settlement.total_cents)}</strong><small>shared spend</small></span>
            <span><strong>{settlement.member_count}</strong><small>members</small></span>
            <span><strong>{settlement.transfers.length}</strong><small>settle-ups</small></span>
          </div>
          <div className="statement-list">
            {settlement.payers.map((payer) => (
              <div key={payer.telegram_user_id} className="statement-row">
                <div>
                  <strong>{payer.first_name ?? payer.username ?? payer.telegram_user_id}</strong>
                  <span>Paid {formatCents(payer.paid_cents)} · share {formatCents(payer.fair_share_cents)}</span>
                </div>
                <span className={Number(payer.balance_cents) >= 0 ? 'positive-amount' : 'negative-amount'}>
                  {formatCents(Math.abs(Number(payer.balance_cents)))}
                </span>
              </div>
            ))}
            {settlement.transfers.length === 0 ? <p>No settlement transfer needed.</p> : settlement.transfers.map((transfer) => (
              <div key={`${transfer.from_telegram_user_id}-${transfer.to_telegram_user_id}`} className="statement-row">
                <div>
                  <strong>{transfer.from_telegram_user_id} pays {transfer.to_telegram_user_id}</strong>
                  <span>{formatCents(transfer.amount_cents)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : <p>No settlement loaded.</p>}
    </section>
  )
}
