'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  getExpenseSummary,
  formatCents,
  formatDate,
  type ExpenseSummary,
  type CategoryTotal,
} from '../../../lib/api'

const BarChart = dynamic(
  () => import('recharts').then((m) => m.BarChart),
  { ssr: false },
)
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false })
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false })
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false })
const ResponsiveContainer = dynamic(
  () => import('recharts').then((m) => m.ResponsiveContainer),
  { ssr: false },
)

function mtdTotal(categories: CategoryTotal[]): number {
  return categories.reduce((sum, c) => sum + parseInt(c.total_cents, 10), 0)
}

function top5(categories: CategoryTotal[]) {
  return categories
    .slice(0, 5)
    .map((c) => ({ name: c.category, value: Math.round(parseInt(c.total_cents, 10) / 100) }))
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getExpenseSummary()
      .then(setSummary)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="page"><div className="error-msg">{error}</div></div>

  return (
    <div className="page">
      <h2 style={{ marginBottom: '1.25rem', fontSize: '1.3rem' }}>Dashboard</h2>

      {!summary ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="stat-card">
              <span className="label">Month-to-date spend</span>
              <span className="value">{formatCents(mtdTotal(summary.mtd))}</span>
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
            <div className="card">
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#374151' }}>
                Top 5 Categories (MTD)
              </h3>
              {summary.mtd.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No expenses this month.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={top5(summary.mtd)} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`₹${v}`, 'Amount']} />
                    <Bar dataKey="value" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
