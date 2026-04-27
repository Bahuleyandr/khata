const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/api/categories')
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
