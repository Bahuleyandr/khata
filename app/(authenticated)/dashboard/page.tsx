'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  getExpenseSummary,
  getInsights,
  formatCents,
  formatDate,
  setSubscriptionPreference,
  type ExpenseSummary,
  type Insight,
  type SubscriptionCandidate,
} from '../../../lib/api'
import { InsightCards } from './InsightCards'
import { MonthlySummary } from './MonthlySummary'

const DashboardCharts = dynamic(() => import('./DashboardCharts'), { ssr: false })

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthValue(value: string) {
  const [year, month] = value.split('-').map(Number)
  return { year, month }
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [monthValue, setMonthValue] = useState(currentMonthValue)
  const [busySubscription, setBusySubscription] = useState<string | null>(null)

  useEffect(() => {
    const { year, month } = parseMonthValue(monthValue)
    getExpenseSummary({ year, month })
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
  }, [monthValue])

  useEffect(() => {
    // Insights are best-effort: a 4xx/5xx here shouldn't take down the rest
    // of the dashboard. Render with `insights = []` if the call fails.
    getInsights()
      .then((r) => setInsights(r.insights))
      .catch(() => setInsights([]))
  }, [])

  async function updateSubscriptionPreference(
    subscription: SubscriptionCandidate,
    status: 'confirmed' | 'ignored',
  ) {
    setBusySubscription(subscription.merchant_key)
    setError(null)
    try {
      await setSubscriptionPreference(subscription.merchant_key, subscription.name, status)
      const { year, month } = parseMonthValue(monthValue)
      setSummary(await getExpenseSummary({ year, month }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update subscription')
    } finally {
      setBusySubscription(null)
    }
  }

  if (error) return <div className="page"><div className="error-msg">{error}</div></div>

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Dashboard</h2>
        <div className="toolbar-inline">
          <input
            type="month"
            aria-label="Dashboard month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
          />
          {summary ? (
            <a
              href={`/api/export/xlsx?year=${summary.period.year}&month=${summary.period.month}`}
              download
              className="button-primary"
            >
              Export
            </a>
          ) : null}
        </div>
      </div>

      {!summary ? (
        <LoadingSkeleton />
      ) : (
        <>
          <MonthlySummary
            categories={summary.mtd}
            now={
              monthValue === currentMonthValue()
                ? new Date()
                : new Date(summary.period.year, summary.period.month - 1, summary.period.daysInMonth)
            }
          />

          <div className="notice-card">
            <strong>{summary.period.label}</strong>
            <span>{summary.narrative}</span>
          </div>

          <DashboardActionCards
            summary={summary}
            busySubscription={busySubscription}
            onSubscriptionPreference={updateSubscriptionPreference}
          />

          <DashboardCharts summary={summary} />

          {insights !== null && <InsightCards insights={insights} />}

          <div className="card recent-card">
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#374151' }}>
              Recent Expenses
            </h3>
            {summary.recent.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No expenses yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Merchant</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.occurred_at)}</td>
                      <td>{e.merchant ?? e.description ?? '—'}</td>
                      <td>{e.category ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {formatCents(e.amount_cents, e.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DashboardActionCards({
  summary,
  busySubscription,
  onSubscriptionPreference,
}: {
  summary: ExpenseSummary
  busySubscription: string | null
  onSubscriptionPreference: (subscription: SubscriptionCandidate, status: 'confirmed' | 'ignored') => Promise<void>
}) {
  const uncategorized = summary.mtd.find((category) => category.category === 'Uncategorized')
  const projectedOver = summary.budgets
    .filter((budget) => budget.projected_variance_cents > 0)
    .sort((a, b) => b.projected_variance_cents - a.projected_variance_cents)
  const topMerchant = summary.merchants.top[0]
  const topSubscription = summary.subscriptions[0]

  return (
    <div className="grid-3 action-grid">
      <div className="card compact-card">
        <span className="eyebrow">Cleanup</span>
        <h3>{uncategorized ? `${uncategorized.count} uncategorized` : 'All categorized'}</h3>
        <p>{uncategorized ? formatCents(uncategorized.total_cents, uncategorized.currency) : 'No cleanup queue.'}</p>
        <Link href={`/review?month=${summary.period.rangeKey}`} className="text-link">Monthly review</Link>
      </div>
      <div className="card compact-card">
        <span className="eyebrow">Budget variance</span>
        <h3>{projectedOver[0] ? projectedOver[0].category_name : 'On pace'}</h3>
        <p>
          {projectedOver[0]
            ? `${formatCents(projectedOver[0].projected_variance_cents)} projected over`
            : 'No projected overruns.'}
        </p>
      </div>
      <div className="card compact-card">
        <span className="eyebrow">Merchant trend</span>
        <h3>{topMerchant?.name ?? 'No merchant data'}</h3>
        <p>{topMerchant ? `${formatCents(topMerchant.total_cents)} across ${topMerchant.count}` : 'Log expenses to see trends.'}</p>
      </div>
      <div className="card compact-card">
        <span className="eyebrow">Subscriptions</span>
        <h3>{topSubscription?.name ?? 'No strong signals'}</h3>
        <p>
          {topSubscription
            ? `${topSubscription.cadence} · ${formatCents(topSubscription.monthly_estimate_cents)} / mo · ${topSubscription.confidence}%`
            : 'Recurring charges need stable cadence and amount.'}
        </p>
        {topSubscription ? (
          <Link href={`/transactions?merchant=${encodeURIComponent(topSubscription.name)}`} className="text-link">
            Review charges
          </Link>
        ) : null}
      </div>

      {summary.budgets.length > 0 ? (
        <div className="card compact-card wide-card">
          <h3>Budget Pace</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th style={{ textAlign: 'right' }}>Projected</th>
                <th style={{ textAlign: 'right' }}>Target</th>
              </tr>
            </thead>
            <tbody>
              {summary.budgets.slice(0, 6).map((budget) => (
                <tr key={budget.id}>
                  <td>{budget.category_name}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.spent_cents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.projected_cents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.target_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {summary.merchants.spikes.length > 0 || summary.merchants.new.length > 0 ? (
        <div className="card compact-card wide-card">
          <h3>Merchant Signals</h3>
          <div className="signal-list">
            {summary.merchants.spikes.slice(0, 3).map((merchant) => (
              <span key={`spike-${merchant.name}`}>Spike: {merchant.name} at {formatCents(merchant.total_cents)}</span>
            ))}
            {summary.merchants.new.slice(0, 3).map((merchant) => (
              <span key={`new-${merchant.name}`}>New: {merchant.name} at {formatCents(merchant.total_cents)}</span>
            ))}
          </div>
        </div>
      ) : null}

      {summary.subscriptions.length > 0 ? (
        <div className="card compact-card wide-card">
          <h3>Subscription Watch</h3>
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Cadence</th>
                <th style={{ textAlign: 'right' }}>Monthly</th>
                <th style={{ textAlign: 'right' }}>Confidence</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {summary.subscriptions.slice(0, 6).map((subscription) => (
                <tr key={subscription.merchant_key}>
                  <td>
                    {subscription.name}
                    {subscription.preference_status === 'confirmed' ? <span className="badge badge-confirmed">Confirmed</span> : null}
                  </td>
                  <td>{subscription.cadence}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCents(subscription.monthly_estimate_cents)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{subscription.confidence}%</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => void onSubscriptionPreference(subscription, 'confirmed')}
                        disabled={busySubscription === subscription.merchant_key || subscription.preference_status === 'confirmed'}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSubscriptionPreference(subscription, 'ignored')}
                        disabled={busySubscription === subscription.merchant_key}
                      >
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div>
      <div className="skeleton" style={{ width: 200, height: 80, marginBottom: '1.5rem', borderRadius: 12 }} />
      <div className="grid-2">
        <div className="skeleton" style={{ height: 280, borderRadius: 12 }} />
        <div className="skeleton" style={{ height: 280, borderRadius: 12 }} />
      </div>
    </div>
  )
}
