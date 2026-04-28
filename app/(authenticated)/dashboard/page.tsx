'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
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

function top5(categories: CategoryTotal[]) {
  return categories
    .slice(0, 5)
    .map((c) => ({ name: c.category, value: Math.round(parseInt(c.total_cents, 10) / 100) }))
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getExpenseSummary()
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
    // Insights are best-effort: a 4xx/5xx here shouldn't take down the rest
    // of the dashboard. Render with `insights = []` if the call fails.
    getInsights()
      .then((r) => setInsights(r.insights))
      .catch(() => setInsights([]))
  }, [])

  if (error) return <div className="page"><div className="error-msg">{error}</div></div>

  return (
    <div className="page">
      <h2 style={{ marginBottom: '1.25rem', fontSize: '1.3rem' }}>Dashboard</h2>

      {!summary ? (
        <LoadingSkeleton />
      ) : (
        <>
          <MonthlySummary categories={summary.mtd} />

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
