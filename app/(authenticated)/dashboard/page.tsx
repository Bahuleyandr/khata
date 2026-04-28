'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  getExpenseSummary,
  getInsights,
  formatCents,
  formatDate,
  type ExpenseSummary,
  type CategoryTotal,
  type Insight,
} from '../../../lib/api'
import { InsightCards } from './InsightCards'
import { MonthlySummary } from './MonthlySummary'

const SpendingChart = dynamic(() => import('./SpendingChart'), { ssr: false })

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthValue(value: string) {
  const [year, month] = value.split('-').map(Number)
  return { year, month }
}

function top5(categories: CategoryTotal[]) {
  return categories
    .slice(0, 5)
    .map((c) => ({ name: c.category, value: Math.round(parseInt(c.total_cents, 10) / 100) }))
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [monthValue, setMonthValue] = useState(currentMonthValue)

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

          <DashboardActionCards summary={summary} />

          {insights !== null && <InsightCards insights={insights} />}

          <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
            <div className="card">
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#374151' }}>
                Top 5 Categories (MTD)
              </h3>
              {summary.mtd.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No expenses this month.</p>
              ) : (
                <SpendingChart data={top5(summary.mtd)} />
              )}
            </div>

            <div className="card">
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
          </div>
        </>
      )}
    </div>
  )
}

function DashboardActionCards({ summary }: { summary: ExpenseSummary }) {
  const uncategorized = summary.mtd.find((category) => category.category === 'Uncategorized')
  const projectedOver = summary.budgets
    .filter((budget) => budget.projected_variance_cents > 0)
    .sort((a, b) => b.projected_variance_cents - a.projected_variance_cents)
  const topMerchant = summary.merchants.top[0]

  return (
    <div className="grid-3 action-grid">
      <div className="card compact-card">
        <span className="eyebrow">Cleanup</span>
        <h3>{uncategorized ? `${uncategorized.count} uncategorized` : 'All categorized'}</h3>
        <p>{uncategorized ? formatCents(uncategorized.total_cents, uncategorized.currency) : 'No cleanup queue.'}</p>
        <Link href="/transactions?uncategorized=true" className="text-link">Review</Link>
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
