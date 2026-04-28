// Empty = same-origin (production: nginx proxies /api/* to the backend).
// For local dev, set NEXT_PUBLIC_API_URL=http://localhost:3001 in .env.local.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(new Error((err as { error?: string }).error ?? res.statusText), {
      status: res.status,
    })
  }
  return res.json() as Promise<T>
}

export interface Me {
  telegram_user_id: number
  first_name: string
}

export interface CategoryTotal {
  category: string
  total_cents: string
  currency: string
  count: string
}

export interface Expense {
  id: string
  amount_cents: string
  currency: string
  description: string | null
  merchant: string | null
  category_id: string | null
  category: string | null
  source: string
  occurred_at: string
  image_key: string | null
}

export interface RecentExpense {
  id: string
  amount_cents: string
  currency: string
  description: string | null
  merchant: string | null
  category: string | null
  occurred_at: string
}

export interface ExpenseSummary {
  mtd: CategoryTotal[]
  recent: RecentExpense[]
}

export interface ExpensePage {
  data: Expense[]
  total: number
  page: number
  totalPages: number
}

export interface Receipt {
  id: string
  amount_cents: string
  currency: string
  description: string | null
  merchant: string | null
  category: string | null
  occurred_at: string
  image_key: string
  receipt_url: string
}

export interface ReceiptPage {
  data: Receipt[]
  total: number
  page: number
  totalPages: number
}

export interface Category {
  id: string
  name: string
}

export function getMe(): Promise<Me> {
  return apiFetch<Me>('/api/me')
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/logout', { method: 'POST' })
}

export function getExpenseSummary(): Promise<ExpenseSummary> {
  return apiFetch<ExpenseSummary>('/api/expenses/summary')
}

export function getExpenses(params: {
  page?: number
  limit?: number
  start?: string
  end?: string
  category?: string
  source?: string
}): Promise<ExpensePage> {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.category) q.set('category', params.category)
  if (params.source) q.set('source', params.source)
  return apiFetch<ExpensePage>(`/api/expenses?${q}`)
}

export interface ExpenseUpdateInput {
  amount_cents?: number
  currency?: string
  description?: string | null
  merchant?: string | null
  category_id?: string | null
  occurred_at?: string
}

export function updateExpense(id: string, data: ExpenseUpdateInput): Promise<Expense> {
  return apiFetch<Expense>(`/api/expenses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteExpense(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/expenses/${id}`, { method: 'DELETE' })
}

export async function mergeExpense(id: string, duplicateId: string): Promise<Expense> {
  const res = await apiFetch<{ ok: boolean; expense: Expense }>(`/api/expenses/${id}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duplicateId }),
  })
  return res.expense
}

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/api/categories')
}

// Insights — populated by the nightly cron (backend/src/cron/insights.ts).
// `kind` discriminates which payload shape to read.

export interface MtdVsLastMonthPayload {
  mtd_cents: number
  last_month_cents: number
  delta_pct: number | null
  categories: Array<{
    name: string
    mtd_cents: number
    last_month_cents: number
    delta_pct: number | null
  }>
}

export interface TopMerchantsMtdPayload {
  merchants: Array<{ name: string; total_cents: number; count: number }>
}

export interface RecurringPayload {
  merchants: Array<{
    name: string
    count: number
    total_cents: number
    first_seen: string
    last_seen: string
  }>
}

export type InsightPayload =
  | MtdVsLastMonthPayload
  | TopMerchantsMtdPayload
  | RecurringPayload

export interface Insight {
  kind: string
  payload: InsightPayload
  period_start: string | null
  period_end: string | null
  computed_at: string
}

export interface InsightsResponse {
  insights: Insight[]
}

export function getInsights(): Promise<InsightsResponse> {
  return apiFetch<InsightsResponse>('/api/insights')
}

export function getReceipts(params: { page?: number; limit?: number }): Promise<ReceiptPage> {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  return apiFetch<ReceiptPage>(`/api/receipts?${q}`)
}

export async function postTelegramAuth(data: Record<string, string>): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/auth/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/**
 * Telegram Mini App auth: sends the WebApp `initData` query-string to the
 * backend, which validates the HMAC signature against the bot token and
 * issues the same session cookie the OAuth flow uses. Throws on rejection
 * (allowlist denial, expired auth_date, bad signature, etc.).
 */
export async function postTelegramWebApp(initData: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/auth/telegram-webapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  })
}

export function formatCents(cents: string | number, currency = 'INR'): string {
  const amount = typeof cents === 'string' ? parseInt(cents, 10) : cents
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
