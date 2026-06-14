'use client'

import { useState } from 'react'
import { formatCents, formatDate, type SubscriptionCandidate, type SubscriptionPreferenceStatus } from '../../../../lib/api'
import { subscriptionBadgeClass, subscriptionTiming, type SubscriptionFilter } from './helpers'

export default function SubscriptionsPanel({
  subscriptions,
  busy,
  onConfirm,
  onIgnore,
  onInactive,
  onClearPreference,
}: {
  subscriptions: SubscriptionCandidate[]
  busy: boolean
  onConfirm: (subscription: SubscriptionCandidate) => Promise<void>
  onIgnore: (subscription: SubscriptionCandidate) => Promise<void>
  onInactive: (subscription: SubscriptionCandidate) => Promise<void>
  onClearPreference: (subscription: SubscriptionCandidate) => Promise<void>
}) {
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>('active')

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

  return (
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
                  <span className={`badge ${subscriptionBadgeClass(subscription.preference_status as SubscriptionPreferenceStatus)}`}>
                    {subscription.preference_status}
                  </span>
                ) : null}
                {subscription.is_overdue ? <span className="badge badge-review">Overdue</span> : null}
              </strong>
              <span>
                {subscription.cadence} · {formatCents(subscription.monthly_estimate_cents, subscription.currency)} / mo · {subscription.confidence}% · {subscription.count} charges
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
                onClick={() => void onConfirm(subscription)}
                disabled={busy || subscription.preference_status === 'confirmed'}
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => void onIgnore(subscription)}
                disabled={busy || subscription.preference_status === 'ignored'}
              >
                Ignore
              </button>
              <button
                type="button"
                onClick={() => void onInactive(subscription)}
                disabled={busy || subscription.preference_status === 'inactive'}
              >
                Inactive
              </button>
              <button
                type="button"
                onClick={() => void onClearPreference(subscription)}
                disabled={busy || !subscription.preference_status}
              >
                Clear
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
