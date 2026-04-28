'use client'

import {
  formatCents,
  type Insight,
  type MtdVsLastMonthPayload,
  type TopMerchantsMtdPayload,
  type RecurringPayload,
} from '../../../lib/api'

function deltaBadge(deltaPct: number | null): { text: string; color: string } | null {
  if (deltaPct === null) return null
  if (deltaPct === 0) return { text: 'flat', color: '#6b7280' }
  const sign = deltaPct > 0 ? '+' : ''
  // Up = red (spending more), down = green (spending less). Cents tracking, not stocks.
  const color = deltaPct > 0 ? '#dc2626' : '#16a34a'
  return { text: `${sign}${deltaPct}%`, color }
}

function MtdVsLastMonthCard({ p }: { p: MtdVsLastMonthPayload }) {
  const badge = deltaBadge(p.delta_pct)
  return (
    <div className="card">
      <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', color: '#374151' }}>
        This month vs last month
      </h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '1.6rem', fontWeight: 600 }}>{formatCents(p.mtd_cents)}</span>
        {badge && (
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: badge.color }}>
            {badge.text}
          </span>
        )}
        <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
          (last month: {formatCents(p.last_month_cents)})
        </span>
      </div>
      {p.categories.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: 0 }}>
          No category breakdown yet.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>This month</th>
              <th style={{ textAlign: 'right' }}>vs last</th>
            </tr>
          </thead>
          <tbody>
            {p.categories.map((c) => {
              const b = deltaBadge(c.delta_pct)
              return (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCents(c.mtd_cents)}
                  </td>
                  <td style={{ textAlign: 'right', color: b?.color ?? '#9ca3af' }}>
                    {b?.text ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TopMerchantsCard({ p }: { p: TopMerchantsMtdPayload }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#374151' }}>
        Top merchants (MTD)
      </h3>
      {p.merchants.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: 0 }}>
          No merchant data this month.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th style={{ textAlign: 'right' }}>Spent</th>
              <th style={{ textAlign: 'right' }}>×</th>
            </tr>
          </thead>
          <tbody>
            {p.merchants.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  {formatCents(m.total_cents)}
                </td>
                <td style={{ textAlign: 'right', color: '#6b7280' }}>{m.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function RecurringCard({ p }: { p: RecurringPayload }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: '#374151' }}>
        Likely recurring
      </h3>
      {p.merchants.length === 0 ? (
        <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: 0 }}>
          No high-confidence subscriptions detected yet.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Cadence</th>
              <th style={{ textAlign: 'right' }}>Monthly</th>
              <th style={{ textAlign: 'right' }}>Confidence</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {p.merchants.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>{m.cadence ?? `${m.count} charges`}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  {formatCents(m.monthly_estimate_cents ?? m.total_cents)}
                </td>
                <td style={{ textAlign: 'right' }}>{m.confidence ? `${m.confidence}%` : '—'}</td>
                <td style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>{m.last_seen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
          Insights are computed nightly. Check back tomorrow morning.
        </p>
      </div>
    )
  }

  const byKind = new Map(insights.map((i) => [i.kind, i]))
  const mtdVsLast = byKind.get('mtd_vs_last_month')
  const topMerchants = byKind.get('top_merchants_mtd')
  const recurring = byKind.get('recurring')

  return (
    <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
      {mtdVsLast && (
        <MtdVsLastMonthCard p={mtdVsLast.payload as MtdVsLastMonthPayload} />
      )}
      {topMerchants && (
        <TopMerchantsCard p={topMerchants.payload as TopMerchantsMtdPayload} />
      )}
      {recurring && (
        <RecurringCard p={recurring.payload as RecurringPayload} />
      )}
    </div>
  )
}
