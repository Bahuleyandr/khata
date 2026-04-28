'use client'

import { formatCents, type CategoryTotal } from '../../../lib/api'
import { buildMonthlySnapshot } from './monthlySnapshot'

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

export function MonthlySummary({
  categories,
  now,
}: {
  categories: CategoryTotal[]
  now?: Date
}) {
  const snapshot = buildMonthlySnapshot(categories, now)
  const topCategory = snapshot.topCategory
    ? `${snapshot.topCategory.name} (${snapshot.topCategory.sharePct}%)`
    : 'No spend yet'

  return (
    <section className="monthly-summary" aria-label="Monthly summary">
      <div className="monthly-summary-main">
        <div>
          <span className="eyebrow">{snapshot.monthLabel}</span>
          <h3>{formatCents(snapshot.totalCents)}</h3>
          <p>
            {formatCount(snapshot.transactionCount, 'transaction')} across{' '}
            {formatCount(snapshot.categoryCount, 'category', 'categories')}
          </p>
        </div>
        <div className="month-progress" aria-label={`${snapshot.progressPct}% of month elapsed`}>
          <span>{snapshot.progressPct}%</span>
          <div>
            <i style={{ width: `${snapshot.progressPct}%` }} />
          </div>
          <small>
            Day {snapshot.elapsedDays} of {snapshot.daysInMonth}
          </small>
        </div>
      </div>

      <dl className="monthly-summary-grid">
        <div>
          <dt>Projected month-end</dt>
          <dd>{formatCents(snapshot.projectedMonthCents)}</dd>
        </div>
        <div>
          <dt>Daily average</dt>
          <dd>{formatCents(snapshot.averageDailyCents)}</dd>
        </div>
        <div>
          <dt>Top category</dt>
          <dd>{topCategory}</dd>
        </div>
        <div>
          <dt>Needs category</dt>
          <dd>{formatCount(snapshot.uncategorizedCount, 'item')}</dd>
        </div>
      </dl>
    </section>
  )
}
