'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExpenseSummary } from '../../../lib/api'
import {
  buildDashboardChartModel,
  type BudgetChartPoint,
  type CaptureChartPoint,
  type ChartPoint,
  type DailyChartPoint,
} from './chartData'

const CATEGORY_COLORS = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#be123c', '#4b5563', '#0891b2', '#65a30d']

function formatRupees(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value)
  const safe = Number.isFinite(number) ? number : 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(safe)
}

function axisRupees(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number === 0) return '0'
  if (Math.abs(number) >= 100000) return `${Math.round(number / 100000)}L`
  if (Math.abs(number) >= 1000) return `${Math.round(number / 1000)}k`
  return String(Math.round(number))
}

function payloadHref(payload: unknown): string | null {
  const point = payload as {
    href?: string
    payload?: { href?: string }
    activePayload?: Array<{ payload?: { href?: string } }>
  }
  return point.href ?? point.payload?.href ?? point.activePayload?.[0]?.payload?.href ?? null
}

function EmptyChart({ label }: { label: string }) {
  return <div className="empty-chart">{label}</div>
}

function ChartLinks({ points }: { points: Array<{ name: string; href: string; value?: number }> }) {
  if (points.length === 0) return null
  return (
    <div className="chart-link-row">
      {points.slice(0, 4).map((point) => (
        <a key={point.href} href={point.href}>
          {point.name}
          {point.value !== undefined ? <span>{formatRupees(point.value)}</span> : null}
        </a>
      ))}
    </div>
  )
}

export default function DashboardCharts({ summary }: { summary: ExpenseSummary }) {
  const router = useRouter()
  const model = useMemo(() => buildDashboardChartModel(summary), [summary])
  const hasDailySpend = model.daily.some((point) => point.value > 0)

  function openDrilldown(payload: unknown) {
    const href = payloadHref(payload)
    if (href) router.push(href)
  }

  return (
    <section className="dashboard-charts" aria-label="Spending charts">
      <DailyTrendCard
        data={model.daily}
        hasSpend={hasDailySpend}
        allHref={`/transactions?start=${summary.period.start}&end=${summary.period.end}`}
        onOpen={openDrilldown}
      />
      <CategoryChartCard data={model.categories} onOpen={openDrilldown} />
      <MerchantChartCard data={model.merchants} onOpen={openDrilldown} />
      <BudgetChartCard data={model.budgets} onOpen={openDrilldown} />
      <CaptureChartCard data={model.capture} onOpen={openDrilldown} />
    </section>
  )
}

function DailyTrendCard({
  data,
  hasSpend,
  allHref,
  onOpen,
}: {
  data: DailyChartPoint[]
  hasSpend: boolean
  allHref: string
  onOpen: (payload: unknown) => void
}) {
  const total = data.at(-1)?.cumulative ?? 0

  return (
    <div className="card chart-card chart-card-wide">
      <div className="chart-card-heading">
        <div>
          <span>Daily Trend</span>
          <h3>{formatRupees(total)} this month</h3>
        </div>
        <a href={allHref}>Transactions</a>
      </div>
      {!hasSpend ? (
        <EmptyChart label="No spending logged for this month." />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} onClick={onOpen}>
            <defs>
              <linearGradient id="dailySpend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0f766e" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={axisRupees} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              formatter={(value, name) => [formatRupees(value), name === 'cumulative' ? 'Cumulative' : 'Spend']}
              labelFormatter={(label) => `Day ${label}`}
            />
            <Area type="monotone" dataKey="value" stroke="#0f766e" fill="url(#dailySpend)" strokeWidth={2} name="Spend" />
            <Line type="monotone" dataKey="cumulative" stroke="#2563eb" strokeWidth={2} dot={false} name="Cumulative" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function CategoryChartCard({
  data,
  onOpen,
}: {
  data: ChartPoint[]
  onOpen: (payload: unknown) => void
}) {
  return (
    <div className="card chart-card">
      <div className="chart-card-heading">
        <div>
          <span>Category Split</span>
          <h3>{data[0]?.name ?? 'No categories yet'}</h3>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyChart label="No category totals yet." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={axisRupees} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip formatter={(value) => [formatRupees(value), 'Spend']} />
              <Bar dataKey="value" radius={[0, 5, 5, 0]} onClick={onOpen}>
                {data.map((point, index) => (
                  <Cell key={point.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} cursor="pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartLinks points={data} />
        </>
      )}
    </div>
  )
}

function MerchantChartCard({
  data,
  onOpen,
}: {
  data: ChartPoint[]
  onOpen: (payload: unknown) => void
}) {
  return (
    <div className="card chart-card">
      <div className="chart-card-heading">
        <div>
          <span>Top Merchants</span>
          <h3>{data[0] ? `${data[0].name}` : 'No merchant data'}</h3>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyChart label="No merchant totals yet." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={axisRupees} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip formatter={(value) => [formatRupees(value), 'Spend']} />
              <Bar dataKey="value" fill="#2563eb" radius={[0, 5, 5, 0]} onClick={onOpen} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
          <ChartLinks points={data} />
        </>
      )}
    </div>
  )
}

function BudgetChartCard({
  data,
  onOpen,
}: {
  data: BudgetChartPoint[]
  onOpen: (payload: unknown) => void
}) {
  const overCount = data.filter((budget) => budget.status === 'over').length

  return (
    <div className="card chart-card">
      <div className="chart-card-heading">
        <div>
          <span>Budget Burn</span>
          <h3>{overCount > 0 ? `${overCount} projected over` : 'On pace'}</h3>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyChart label="Set budgets to see burn rate." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tickFormatter={axisRupees} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip formatter={(value, name) => [formatRupees(value), name === 'remaining' ? 'Remaining' : 'Spent']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="spent" stackId="budget" name="Spent" radius={[0, 0, 0, 0]} onClick={onOpen}>
                {data.map((budget) => (
                  <Cell
                    key={budget.name}
                    fill={budget.status === 'over' ? '#be123c' : budget.status === 'tight' ? '#d97706' : '#0f766e'}
                    cursor="pointer"
                  />
                ))}
              </Bar>
              <Bar dataKey="remaining" stackId="budget" name="Remaining" fill="#e5e7eb" radius={[0, 5, 5, 0]} onClick={onOpen} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
          <div className="budget-chip-row">
            {data.slice(0, 4).map((budget) => (
              <a key={budget.href} href={budget.href} className={budget.status}>
                {budget.name}
                <span>{budget.pct}%</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CaptureChartCard({
  data,
  onOpen,
}: {
  data: CaptureChartPoint[]
  onOpen: (payload: unknown) => void
}) {
  return (
    <div className="card chart-card">
      <div className="chart-card-heading">
        <div>
          <span>Capture Mix</span>
          <h3>{data.length > 0 ? `${data.reduce((sum, point) => sum + point.count, 0)} entries` : 'No captures yet'}</h3>
        </div>
      </div>
      {data.length === 0 ? (
        <EmptyChart label="Capture sources will appear here." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
              <Tooltip formatter={(value, name) => [value, name === 'needsReview' ? 'Needs review' : name === 'reviewed' ? 'Reviewed' : 'Ignored']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="reviewed" stackId="capture" name="Reviewed" fill="#0f766e" radius={[0, 0, 0, 0]} onClick={onOpen} cursor="pointer" />
              <Bar dataKey="needsReview" stackId="capture" name="Needs review" fill="#d97706" radius={[5, 5, 0, 0]} onClick={onOpen} cursor="pointer" />
              <Bar dataKey="ignored" stackId="capture" name="Ignored" fill="#94a3b8" radius={[5, 5, 0, 0]} onClick={onOpen} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
          <div className="capture-list">
            {data.map((point) => (
              <a key={point.href} href={point.href}>
                <strong>{point.name}</strong>
                <span>{point.count} total</span>
                <em>{point.needsReview} review</em>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
