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

export interface SummaryPeriod {
  year: number
  month: number
  label: string
  start: string
  end: string
  rangeKey: string
  elapsedDays: number
  daysInMonth: number
}

export interface BudgetVariance {
  id: string
  category_id: string
  category_name: string
  target_cents: number
  period: string
  spent_cents: number
  pct: number
  projected_cents: number
  variance_cents: number
  projected_variance_cents: number
}

export interface MerchantTrend {
  name: string
  total_cents: string
  count: number
  previous_avg_cents?: string
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
  review_status: 'needs_review' | 'reviewed' | 'ignored'
  tags: string[]
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
  period: SummaryPeriod
  mtd: CategoryTotal[]
  recent: RecentExpense[]
  budgets: BudgetVariance[]
  merchants: {
    top: MerchantTrend[]
    new: MerchantTrend[]
    spikes: MerchantTrend[]
  }
  narrative: string
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
  category_id: string | null
  category: string | null
  occurred_at: string
  image_key: string
  receipt_url: string
  raw_text: string | null
  review_status: 'needs_review' | 'reviewed' | 'ignored'
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
  is_default: boolean
}

export interface Tag {
  id: string
  name: string
  count: number
}

export interface StatementImport {
  id: string
  file_key: string
  mime_type: string | null
  status: string
  parsed_count: number
  imported_count: number
  duplicate_count: number
  error_reason: string | null
  created_at: string
  updated_at: string
}

export interface MonthlyReviewTask {
  id: 'uncategorized' | 'receipts' | 'duplicates' | 'statements' | 'budgets' | 'export'
  label: string
  detail: string
  count: number
  amount_cents?: string
  status: 'done' | 'attention' | 'ready'
  href: string
}

export interface MonthlyReview {
  period: SummaryPeriod
  overview: {
    transaction_count: number
    total_cents: string
    uncategorized_count: number
    uncategorized_cents: string
    needs_review_count: number
    receipts_needs_review_count: number
    missing_receipt_count: number
    duplicate_candidate_count: number
    open_task_count: number
  }
  tasks: MonthlyReviewTask[]
  budgets: BudgetVariance[]
  statements: {
    total: number
    failed: number
    pending: number
    parsed: number
    imported: number
    parsed_count: number
    imported_count: number
    duplicate_count: number
  }
  samples: Array<{
    id: string
    amount_cents: string
    currency: string
    merchant: string | null
    description: string | null
    category: string | null
    review_status: 'needs_review' | 'reviewed' | 'ignored'
    occurred_at: string
  }>
  narrative: string
}

export interface AuditEvent {
  id: string
  actor_user_id: string
  action: string
  entity_type: string
  entity_id: string | null
  before: unknown
  after: unknown
  metadata: Record<string, unknown>
  created_at: string
}

export function getMe(): Promise<Me> {
  return apiFetch<Me>('/api/me')
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/logout', { method: 'POST' })
}

export function getExpenseSummary(params: { year?: number; month?: number } = {}): Promise<ExpenseSummary> {
  const q = new URLSearchParams()
  if (params.year) q.set('year', String(params.year))
  if (params.month) q.set('month', String(params.month))
  return apiFetch<ExpenseSummary>(`/api/expenses/summary?${q}`)
}

export function getMonthlyReview(params: { year?: number; month?: number } = {}): Promise<MonthlyReview> {
  const q = new URLSearchParams()
  if (params.year) q.set('year', String(params.year))
  if (params.month) q.set('month', String(params.month))
  return apiFetch<MonthlyReview>(`/api/review/monthly?${q}`)
}

export function getExpenses(params: {
  page?: number
  limit?: number
  start?: string
  end?: string
  category?: string
  source?: string
  merchant?: string
  minAmountCents?: number
  maxAmountCents?: number
  tag?: string
  uncategorized?: boolean
  hasReceipt?: boolean
  reviewStatus?: string
  duplicates?: boolean
}): Promise<ExpensePage> {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.category) q.set('category', params.category)
  if (params.source) q.set('source', params.source)
  if (params.merchant) q.set('merchant', params.merchant)
  if (params.minAmountCents !== undefined) q.set('min_amount_cents', String(params.minAmountCents))
  if (params.maxAmountCents !== undefined) q.set('max_amount_cents', String(params.maxAmountCents))
  if (params.tag) q.set('tag', params.tag)
  if (params.uncategorized !== undefined) q.set('uncategorized', String(params.uncategorized))
  if (params.hasReceipt !== undefined) q.set('has_receipt', String(params.hasReceipt))
  if (params.reviewStatus) q.set('review_status', params.reviewStatus)
  if (params.duplicates !== undefined) q.set('duplicates', String(params.duplicates))
  return apiFetch<ExpensePage>(`/api/expenses?${q}`)
}

export interface ExpenseUpdateInput {
  amount_cents?: number
  currency?: string
  description?: string | null
  merchant?: string | null
  category_id?: string | null
  occurred_at?: string
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
}

export interface ExpenseCreateInput {
  amount_cents: number
  currency?: string
  description?: string | null
  merchant?: string | null
  category_id?: string | null
  occurred_at: string
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
  tag_names?: string[]
}

export function createExpense(data: ExpenseCreateInput): Promise<Expense> {
  return apiFetch<Expense>('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
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

export function getDuplicateCandidates(id: string): Promise<{ candidates: Expense[] }> {
  return apiFetch<{ candidates: Expense[] }>(`/api/expenses/${id}/duplicates`)
}

export async function bulkUpdateExpenses(data: {
  ids: string[]
  category_id?: string | null
  tag_names?: string[]
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
}): Promise<{ ok: boolean; updated: number }> {
  return apiFetch<{ ok: boolean; updated: number }>('/api/expenses/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function attachReceipt(id: string, file: File): Promise<Expense> {
  const body = new FormData()
  body.set('receipt', file)
  return apiFetch<Expense>(`/api/expenses/${id}/receipt`, {
    method: 'POST',
    body,
  })
}

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/api/categories')
}

export function createCategory(name: string): Promise<Category> {
  return apiFetch<Category>('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function renameCategory(id: string, name: string): Promise<Category> {
  return apiFetch<Category>(`/api/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' })
}

export function getBudgets(month?: string): Promise<{ month: string; budgets: BudgetVariance[] }> {
  const q = new URLSearchParams()
  if (month) q.set('month', month)
  return apiFetch<{ month: string; budgets: BudgetVariance[] }>(`/api/budgets?${q}`)
}

export async function setBudget(categoryId: string, targetCents: number): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: categoryId, target_cents: targetCents }),
  })
}

export async function clearBudget(categoryId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/budgets/${categoryId}`, { method: 'DELETE' })
}

export function getTags(): Promise<{ tags: Tag[] }> {
  return apiFetch<{ tags: Tag[] }>('/api/tags')
}

export async function addExpenseTag(id: string, name: string): Promise<void> {
  await apiFetch<{ ok: boolean; tag_id: string }>(`/api/expenses/${id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function removeExpenseTag(id: string, tagId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/expenses/${id}/tags/${tagId}`, { method: 'DELETE' })
}

export function getStatements(): Promise<{ statements: StatementImport[] }> {
  return apiFetch<{ statements: StatementImport[] }>('/api/statements')
}

export function getAuditLog(limit = 50): Promise<{ events: AuditEvent[] }> {
  const q = new URLSearchParams()
  q.set('limit', String(limit))
  return apiFetch<{ events: AuditEvent[] }>(`/api/audit-log?${q}`)
}

export async function retryStatement(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/statements/${id}/retry`, { method: 'POST' })
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

export function getReceipts(params: {
  page?: number
  limit?: number
  start?: string
  end?: string
  reviewStatus?: string
}): Promise<ReceiptPage> {
  const q = new URLSearchParams()
  if (params.page) q.set('page', String(params.page))
  if (params.limit) q.set('limit', String(params.limit))
  if (params.start) q.set('start', params.start)
  if (params.end) q.set('end', params.end)
  if (params.reviewStatus) q.set('review_status', params.reviewStatus)
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
