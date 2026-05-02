'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  formatCents,
  formatDate,
  getMonthlyReview,
  withLedgerParam,
  type MonthlyReview,
  type MonthlyReviewTask,
} from '../../../lib/api'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthValue(value: string) {
  const [year, month] = value.split('-').map(Number)
  return { year, month }
}

function taskStatusLabel(task: MonthlyReviewTask) {
  if (task.status === 'done') return 'Done'
  if (task.status === 'ready') return 'Ready'
  return 'Needs attention'
}

function taskMetric(task: MonthlyReviewTask) {
  if (task.id === 'export') return task.count > 0 ? `${task.count} rows` : 'No rows'
  if (task.amount_cents) return `${task.count} · ${formatCents(task.amount_cents)}`
  return String(task.count)
}

export default function ReviewPage() {
  const [monthValue, setMonthValue] = useState(currentMonthValue)
  const [review, setReview] = useState<MonthlyReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const month = new URLSearchParams(window.location.search).get('month')
    if (month && /^\d{4}-\d{2}$/.test(month)) setMonthValue(month)
  }, [])

  useEffect(() => {
    const { year, month } = parseMonthValue(monthValue)
    setLoading(true)
    setError(null)
    getMonthlyReview({ year, month })
      .then((data) => {
        setReview(data)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [monthValue])

  const doneCount = useMemo(
    () => review?.tasks.filter((task) => task.status !== 'attention').length ?? 0,
    [review],
  )
  const totalTasks = review?.tasks.length ?? 0
  const completionPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0
  const projectedOver = review?.budgets
    .filter((budget) => budget.projected_variance_cents > 0)
    .sort((a, b) => b.projected_variance_cents - a.projected_variance_cents)
    .slice(0, 4)

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Monthly Review</h2>
        <div className="toolbar-inline">
          <input
            type="month"
            aria-label="Review month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
          />
          {review ? (
            <a href={withLedgerParam(review.tasks.find((task) => task.id === 'export')?.href ?? '/api/export/xlsx')} download className="button-primary">
              Export
            </a>
          ) : null}
        </div>
      </div>

      {error ? <div className="error-msg">{error}</div> : null}
      {loading || !review ? (
        <ReviewSkeleton />
      ) : (
        <>
          <section className="review-hero">
            <div>
              <span className="eyebrow">{review.period.label}</span>
              <h3>{review.overview.open_task_count === 0 ? 'Ready to close' : `${review.overview.open_task_count} areas open`}</h3>
              <p>{review.narrative}</p>
            </div>
            <div className="review-progress">
              <strong>{completionPct}%</strong>
              <span>{doneCount} of {totalTasks} checks clear</span>
              <div><i style={{ width: `${completionPct}%` }} /></div>
            </div>
          </section>

          <section className="review-metrics">
            <div>
              <span>Total spend</span>
              <strong>{formatCents(review.overview.total_cents)}</strong>
            </div>
            <div>
              <span>Transactions</span>
              <strong>{review.overview.transaction_count}</strong>
            </div>
            <div>
              <span>Review queue</span>
              <strong>{review.overview.needs_review_count}</strong>
            </div>
            <div>
              <span>Statement rows</span>
              <strong>{review.statements.imported_count}/{review.statements.parsed_count}</strong>
            </div>
          </section>

          <section className="review-layout">
            <div className="card review-checklist">
              <h3>Close Checklist</h3>
              <div className="review-task-list">
                {review.tasks.map((task) => (
                  <Link key={task.id} href={task.href} className={`review-task ${task.status}`}>
                    <span className="review-task-status">{taskStatusLabel(task)}</span>
                    <strong>{task.label}</strong>
                    <small>{task.detail}</small>
                    <em>{taskMetric(task)}</em>
                  </Link>
                ))}
              </div>
            </div>

            <div className="review-side-stack">
              <div className="card review-panel">
                <h3>Budget Variance</h3>
                {projectedOver && projectedOver.length > 0 ? (
                  <div className="variance-list">
                    {projectedOver.map((budget) => (
                      <div key={budget.id}>
                        <span>{budget.category_name}</span>
                        <strong>{formatCents(budget.projected_variance_cents)} over</strong>
                        <small>{formatCents(budget.spent_cents)} spent of {formatCents(budget.target_cents)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No projected budget overruns.</p>
                )}
              </div>

              <div className="card review-panel">
                <h3>Needs Review</h3>
                {review.samples.length > 0 ? (
                  <div className="review-sample-list">
                    {review.samples.map((expense) => (
                      <Link
                        key={expense.id}
                        href={
                          expense.category === 'Uncategorized'
                            ? `/transactions?start=${review.period.start}&end=${review.period.end}&uncategorized=true`
                            : `/transactions?start=${review.period.start}&end=${review.period.end}&review_status=${expense.review_status}`
                        }
                      >
                        <strong>{expense.merchant ?? expense.description ?? 'Untitled'}</strong>
                        <span>{formatCents(expense.amount_cents, expense.currency)} · {expense.category ?? 'Uncategorized'}</span>
                        <small>{formatDate(expense.occurred_at)}</small>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p>No uncategorized or review-flagged transactions.</p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function ReviewSkeleton() {
  return (
    <div>
      <div className="skeleton" style={{ height: 132, borderRadius: 10, marginBottom: '1rem' }} />
      <div className="grid-2">
        <div className="skeleton" style={{ height: 360, borderRadius: 10 }} />
        <div className="skeleton" style={{ height: 360, borderRadius: 10 }} />
      </div>
    </div>
  )
}
