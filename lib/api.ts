// Empty = same-origin (production: nginx proxies /api/* to the backend).
// For local dev, set NEXT_PUBLIC_API_URL=http://localhost:3001 in .env.local.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''
const LEDGER_STORAGE_KEY = 'khata.selectedLedgerId'

export function getSelectedLedgerId(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LEDGER_STORAGE_KEY)
  if (!raw || !/^-?\d+$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed !== 0 ? parsed : null
}

export function setSelectedLedgerId(ledgerId: number | null): void {
  if (typeof window === 'undefined') return
  if (ledgerId === null) window.localStorage.removeItem(LEDGER_STORAGE_KEY)
  else window.localStorage.setItem(LEDGER_STORAGE_KEY, String(ledgerId))
}

export function withLedgerParam(path: string): string {
  const ledgerId = getSelectedLedgerId()
  if (!ledgerId || /(?:\?|&)ledger_id=/.test(path)) return path
  const joiner = path.includes('?') ? '&' : '?'
  return `${path}${joiner}ledger_id=${encodeURIComponent(String(ledgerId))}`
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const selectedLedgerId = getSelectedLedgerId()
  if (selectedLedgerId !== null && !headers.has('X-Khata-Ledger-Id')) {
    headers.set('X-Khata-Ledger-Id', String(selectedLedgerId))
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(new Error((err as { error?: string }).error ?? res.statusText), {
      status: res.status,
      data: err,
    })
  }
  return res.json() as Promise<T>
}

export function apiAssetUrl(path: string): string {
  if (!path || path.startsWith('http://') || path.startsWith('https://') || !API_BASE) {
    return path
  }
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export interface Me {
  telegram_user_id: number
  ledger_user_id: number
  personal_ledger_id: number
  first_name: string
  role: AccessRole
  is_owner: boolean
  selected_ledger_id: number
  selected_ledger_name: string
  selected_ledger_kind: LedgerKind
  can_view: boolean
  can_add: boolean
  can_manage: boolean
}

export type AccessRole = 'owner' | 'member'
export type AccessStatus = 'active' | 'pending' | 'revoked'
export type LedgerKind = 'personal' | 'household'

export interface Ledger {
  id: number
  name: string
  kind: LedgerKind
  owner_telegram_user_id: number
  role: AccessRole
  can_view: boolean
  can_add: boolean
  can_manage: boolean
}

export interface AccessUser {
  telegram_user_id: number
  first_name: string | null
  username: string | null
  role: AccessRole
  status: AccessStatus
  ledger_id: number
  ledger_name: string
  ledger_kind: LedgerKind
  ledger_user_id: number | null
  invited_by: number | null
  can_view: boolean
  can_add: boolean
  can_manage: boolean
  created_at: string
  updated_at: string
  last_login_at: string | null
  revoked_at: string | null
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

export interface DailyTotal {
  date: string
  day: number
  total_cents: string
  count: number
  cumulative_cents: string
}

export interface SourceBreakdown {
  source: string
  total_cents: string
  count: number
  needs_review_count: number
  reviewed_count: number
  ignored_count: number
}

export interface SubscriptionCandidate {
  name: string
  merchant_key: string
  currency: string
  count: number
  total_cents: string
  first_seen: string
  last_seen: string
  cadence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'irregular'
  confidence: number
  avg_amount_cents: string
  monthly_estimate_cents: string
  avg_interval_days: number | null
  interval_jitter_days: number | null
  amount_variance_pct: number
  charge_dates: string[]
  next_expected_at: string | null
  days_until_next: number | null
  is_overdue: boolean
  not_seen_this_month: boolean
  preference_status: SubscriptionPreferenceStatus | null
}

export type SubscriptionPreferenceStatus = 'confirmed' | 'ignored' | 'inactive'

export type ManagedSubscriptionStatus = 'active' | 'trial' | 'paused' | 'cancelled'
export type BillingCycle = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
export type SubscriptionActivityStatus =
  | 'ok'
  | 'due_soon'
  | 'overdue'
  | 'missing_due_date'
  | 'not_seen'
  | 'price_review'
  | 'inactive'

export interface ManagedSubscription {
  id: string
  user_id: string
  merchant_key: string | null
  name: string
  status: ManagedSubscriptionStatus
  billing_cycle: BillingCycle
  interval_days: number | null
  amount_cents: string
  currency: string
  category_id: string | null
  category: string | null
  account_id: string | null
  account: string | null
  payment_method: string | null
  started_at: string | null
  next_due_at: string | null
  days_until_next: number | null
  monthly_estimate_cents: string
  yearly_estimate_cents: string
  converted_amount_cents?: string | null
  converted_monthly_estimate_cents?: string | null
  converted_yearly_estimate_cents?: string | null
  activity_status?: SubscriptionActivityStatus
  last_seen?: string | null
  detected_monthly_estimate_cents?: string | null
  price_delta_cents?: string | null
  price_delta_pct?: number | null
  needs_price_review?: boolean
  reminder_days: number[]
  notes: string | null
  logo_url: string | null
  source: 'manual' | 'detected'
  created_at: string
  updated_at: string
}

export interface FxRate {
  base_currency: string
  quote_currency: string
  rate: number
  source: 'identity' | 'frankfurter' | 'cached' | 'stale'
  as_of: string | null
  fetched_at: string | null
}

export interface FxConversionSummary {
  base_currency: string
  source: 'frankfurter'
  rates: FxRate[]
  missing_currencies: string[]
  stale: boolean
  fetched_at: string | null
}

export interface SubscriptionRenewal {
  id: string
  name: string
  status: ManagedSubscriptionStatus
  due_date: string
  days_until_next: number
  amount_cents: string
  converted_amount_cents?: string | null
  currency: string
  account: string | null
  payment_method: string | null
  activity_status: SubscriptionActivityStatus
}

export interface SubscriptionSummary {
  active_count: number
  trial_count: number
  paused_count: number
  cancelled_count: number
  due_soon_count: number
  overdue_count: number
  monthly_total_cents: string
  yearly_total_cents: string
  base_currency?: string
  converted_monthly_total_cents?: string
  converted_yearly_total_cents?: string
  price_review_count?: number
  missing_due_date_count?: number
  not_seen_count?: number
  upcoming_30_days_count?: number
  upcoming_30_days_total_cents?: string
  upcoming_renewals?: SubscriptionRenewal[]
  fx?: FxConversionSummary
}

export interface SubscriptionRecordInput {
  name: string
  status: ManagedSubscriptionStatus
  billing_cycle: BillingCycle
  amount_cents: number
  currency: string
  category_id?: string | null
  account_id?: string | null
  payment_method?: string | null
  started_at?: string | null
  next_due_at?: string | null
  interval_days?: number | null
  reminder_days?: number[]
  notes?: string | null
  logo_url?: string | null
  merchant_key?: string | null
}

export interface CaptureConfidence {
  overall: number
  amount: number
  date: number
  merchant: number
  category: number
  account: number
  source: number
  reasons: string[]
}

export interface Expense {
  id: string
  amount_cents: string
  currency: string
  description: string | null
  merchant: string | null
  category_id: string | null
  category: string | null
  account_id: string | null
  account: string | null
  source: string
  occurred_at: string
  image_key: string | null
  review_status: 'needs_review' | 'reviewed' | 'ignored'
  confidence: CaptureConfidence
  paid_by_user_id: string | null
  settlement_scope: 'personal' | 'shared' | 'reimbursable'
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
  daily: DailyTotal[]
  sources: SourceBreakdown[]
  budgets: BudgetVariance[]
  merchants: {
    top: MerchantTrend[]
    new: MerchantTrend[]
    spikes: MerchantTrend[]
  }
  subscriptions: SubscriptionCandidate[]
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
  confidence?: CaptureConfidence
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

export type AccountType = 'bank' | 'card' | 'cash' | 'wallet' | 'upi' | 'other'

export interface Account {
  id: string
  name: string
  type: AccountType
  institution: string | null
  last_four: string | null
  is_default: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
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
  account_id: string | null
  account: string | null
  created_at: string
  updated_at: string
}

export interface StatementImportRow {
  id: string
  statement_id: string
  row_index: number
  occurred_at: string
  description: string
  amount_cents: string
  currency: string
  suggested_category: string | null
  category_id: string | null
  category: string | null
  account_id: string | null
  account: string | null
  tag_names: string[]
  already_logged: boolean
  matched_expense_id: string | null
  status: 'pending' | 'imported' | 'ignored' | 'duplicate'
  imported_expense_id: string | null
  created_at: string
  updated_at: string
}

export interface StatementRowUpdateInput {
  status?: 'pending' | 'ignored'
  category_id?: string | null
  account_id?: string | null
  tag_names?: string[]
}

export type SmartRuleMatchScope = 'merchant' | 'description' | 'raw_text' | 'any'
export type SmartRuleMatchType = 'contains' | 'equals' | 'regex'

export interface SmartRule {
  id: string
  name: string
  priority: number
  enabled: boolean
  match_scope: SmartRuleMatchScope
  match_type: SmartRuleMatchType
  pattern: string
  category_id: string | null
  category: string | null
  account_id: string | null
  account: string | null
  tag_names: string[]
  review_status: 'needs_review' | 'reviewed' | 'ignored' | null
  created_at: string
  updated_at: string
}

export interface CaptureEvent {
  id: string
  source: string
  raw_text: string | null
  file_key: string | null
  content_hash: string | null
  mime_type: string | null
  status: 'pending' | 'processed' | 'failed' | 'ignored'
  parsed_expense_id: string | null
  parsed_expense_label: string | null
  error_reason: string | null
  failure_kind: string | null
  diagnosis: {
    title: string
    detail: string
    next_action: string
    replayable: boolean
  }
  metadata: Record<string, unknown>
  confidence: Partial<CaptureConfidence>
  replay_count: number
  created_at: string
  updated_at: string
  processed_at: string | null
  last_replayed_at: string | null
}

export interface CaptureFailureSummary {
  failure_kind: string
  count: number
  latest_error: string | null
  latest_at: string
}

export interface CaptureCountSummary {
  key: string
  count: number
}

export interface UserAlert {
  id: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  href: string | null
  status: 'open' | 'dismissed' | 'resolved'
  created_at: string
  updated_at: string
  dismissed_at: string | null
}

export interface ReconciliationItem {
  status: 'matched' | 'missing_in_khata' | 'missing_in_statement' | 'amount_mismatch'
  expense_id: string | null
  statement_row_id: string | null
  occurred_at: string
  description: string
  amount_cents: string
  statement_amount_cents: string | null
  currency: string
  account_id: string | null
  account: string | null
  amount_delta_cents: string
}

export interface ReconciliationResult {
  summary: {
    period: { year: number; month: number; start: string; end: string; label: string }
    account_id: string | null
    account: string | null
    expense_count: number
    statement_count: number
    matched_count: number
    missing_in_khata: number
    missing_in_statement: number
    amount_mismatch: number
    total_expense_cents: string
    total_statement_cents: string
  }
  items: ReconciliationItem[]
}

export interface RuleSuggestion {
  id: string
  source: 'correction' | 'statement_row' | 'bulk_correction'
  source_entity_type: string | null
  source_entity_id: string | null
  merchant: string | null
  pattern: string
  match_scope: SmartRuleMatchScope
  match_type: SmartRuleMatchType
  category_id: string | null
  category: string | null
  account_id: string | null
  account: string | null
  tag_names: string[]
  reason: string
  status: 'pending' | 'accepted' | 'dismissed'
  smart_rule_id: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

export interface HouseholdSettlement {
  period: { year: number; month: number; start: string; end: string; label: string }
  total_cents: string
  member_count: number
  payers: Array<{
    telegram_user_id: string
    first_name: string | null
    username: string | null
    paid_cents: string
    fair_share_cents: string
    balance_cents: string
  }>
  transfers: Array<{
    from_telegram_user_id: string
    to_telegram_user_id: string
    amount_cents: string
  }>
}

export interface RestoreDrill {
  id: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  backup_key: string | null
  checked_at: string
  duration_ms: number | null
  detail: Record<string, unknown>
  error_reason: string | null
  created_at: string
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

export type MonthlyCloseStatus = 'open' | 'ready' | 'closed' | 'reopened'

export interface MonthlyCloseState {
  status: MonthlyCloseStatus
  readiness_score: number
  can_close: boolean
  blockers: Array<{
    id: MonthlyReviewTask['id']
    label: string
    count: number
    href: string
  }>
  exported_at: string | null
  closed_at: string | null
  reopened_at: string | null
  close_note: string | null
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
  close: MonthlyCloseState
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
  undone_at: string | null
  undone_by: string | null
  undo_event_id: string | null
  undo_error: string | null
}

export function getMe(): Promise<Me> {
  return apiFetch<Me>('/api/me')
}

export function getLedgers(): Promise<{ selected_ledger_id: number; ledgers: Ledger[] }> {
  return apiFetch<{ selected_ledger_id: number; ledgers: Ledger[] }>('/api/ledgers')
}

export function getAccessUsers(): Promise<{ users: AccessUser[] }> {
  return apiFetch<{ users: AccessUser[] }>('/api/access/users')
}

export function grantAccessUser(data: {
  telegram_user_id: number | string
  first_name?: string | null
  username?: string | null
  role?: AccessRole
  can_view?: boolean
  can_add?: boolean
}): Promise<AccessUser> {
  return apiFetch<AccessUser>('/api/access/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateAccessUserRole(
  telegramUserId: number,
  data: { role?: AccessRole; can_view?: boolean; can_add?: boolean },
): Promise<AccessUser> {
  return apiFetch<AccessUser>(`/api/access/users/${telegramUserId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function revokeAccessUser(telegramUserId: number): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/access/users/${telegramUserId}`, { method: 'DELETE' })
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

export function markMonthlyReviewExported(params: {
  year: number
  month: number
  note?: string
}): Promise<{ ok: boolean; close: MonthlyCloseState }> {
  return apiFetch<{ ok: boolean; close: MonthlyCloseState }>('/api/review/monthly/exported', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function closeMonthlyReview(params: {
  year: number
  month: number
  note?: string
}): Promise<{ ok: boolean; close: MonthlyCloseState }> {
  return apiFetch<{ ok: boolean; close: MonthlyCloseState }>('/api/review/monthly/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function reopenMonthlyReview(params: {
  year: number
  month: number
  note?: string
}): Promise<{ ok: boolean; close: MonthlyCloseState }> {
  return apiFetch<{ ok: boolean; close: MonthlyCloseState }>('/api/review/monthly/reopen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
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
  accountId?: string
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
  if (params.accountId) q.set('account_id', params.accountId)
  return apiFetch<ExpensePage>(`/api/expenses?${q}`)
}

export interface ExpenseUpdateInput {
  amount_cents?: number
  currency?: string
  description?: string | null
  merchant?: string | null
  category_id?: string | null
  account_id?: string | null
  occurred_at?: string
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
  paid_by_user_id?: number | null
  settlement_scope?: 'personal' | 'shared' | 'reimbursable'
}

export interface ExpenseCreateInput {
  amount_cents: number
  currency?: string
  description?: string | null
  merchant?: string | null
  category_id?: string | null
  account_id?: string | null
  occurred_at: string
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
  tag_names?: string[]
  paid_by_user_id?: number | null
  settlement_scope?: 'personal' | 'shared' | 'reimbursable'
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
  account_id?: string | null
  tag_names?: string[]
  review_status?: 'needs_review' | 'reviewed' | 'ignored'
  settlement_scope?: 'personal' | 'shared' | 'reimbursable'
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

export function getAccounts(params: { includeArchived?: boolean } = {}): Promise<{ accounts: Account[] }> {
  const q = new URLSearchParams()
  if (params.includeArchived !== undefined) q.set('include_archived', String(params.includeArchived))
  return apiFetch<{ accounts: Account[] }>(`/api/accounts?${q}`)
}

export function createAccount(data: {
  name: string
  type?: AccountType
  institution?: string | null
  last_four?: string | null
  is_default?: boolean
}): Promise<Account> {
  return apiFetch<Account>('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateAccount(
  id: string,
  data: Partial<{
    name: string
    type: AccountType
    institution: string | null
    last_four: string | null
    is_default: boolean
  }>,
): Promise<Account> {
  return apiFetch<Account>(`/api/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function archiveAccount(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' })
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

export async function uploadStatement(file: File, accountId?: string): Promise<{
  statement: StatementImport
  rows: StatementImportRow[]
  parsed_count: number
  imported_count: number
  duplicate_count: number
}> {
  const body = new FormData()
  body.set('statement', file)
  const q = new URLSearchParams()
  if (accountId) q.set('account_id', accountId)
  return apiFetch<{
    statement: StatementImport
    rows: StatementImportRow[]
    parsed_count: number
    imported_count: number
    duplicate_count: number
  }>(`/api/statements/upload?${q}`, {
    method: 'POST',
    body,
  })
}

export function getStatementRows(id: string): Promise<{ rows: StatementImportRow[] }> {
  return apiFetch<{ rows: StatementImportRow[] }>(`/api/statements/${id}/rows`)
}

export async function importStatementRows(id: string, rowIds?: string[]): Promise<{
  ok: boolean
  imported_count: number
  statement: StatementImport | null
}> {
  return apiFetch<{ ok: boolean; imported_count: number; statement: StatementImport | null }>(
    `/api/statements/${id}/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rowIds && rowIds.length > 0 ? { row_ids: rowIds } : {}),
    },
  )
}

export function updateStatementImportRow(
  statementId: string,
  rowId: string,
  data: StatementRowUpdateInput,
): Promise<StatementImportRow> {
  return apiFetch<StatementImportRow>(`/api/statements/${statementId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function getAuditLog(
  params: number | { limit?: number; action?: string; entityType?: string; entityId?: string } = 50,
): Promise<{ events: AuditEvent[] }> {
  const normalized = typeof params === 'number' ? { limit: params } : params
  const q = new URLSearchParams()
  q.set('limit', String(normalized.limit ?? 50))
  if (normalized.action) q.set('action', normalized.action)
  if (normalized.entityType) q.set('entity_type', normalized.entityType)
  if (normalized.entityId) q.set('entity_id', normalized.entityId)
  return apiFetch<{ events: AuditEvent[] }>(`/api/audit-log?${q}`)
}

export async function undoAuditEvent(id: string): Promise<AuditEvent> {
  const res = await apiFetch<{ ok: boolean; event: AuditEvent }>(`/api/audit-log/${id}/undo`, {
    method: 'POST',
  })
  return res.event
}

export function getSmartRules(): Promise<{ rules: SmartRule[] }> {
  return apiFetch<{ rules: SmartRule[] }>('/api/rules')
}

export function createSmartRule(data: {
  name: string
  priority?: number
  enabled?: boolean
  match_scope?: SmartRuleMatchScope
  match_type?: SmartRuleMatchType
  pattern: string
  category_id?: string | null
  account_id?: string | null
  tag_names?: string[]
  review_status?: 'needs_review' | 'reviewed' | 'ignored' | null
}): Promise<SmartRule> {
  return apiFetch<SmartRule>('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateSmartRule(
  id: string,
  data: Partial<{
    name: string
    priority: number
    enabled: boolean
    match_scope: SmartRuleMatchScope
    match_type: SmartRuleMatchType
    pattern: string
    category_id: string | null
    account_id: string | null
    tag_names: string[]
    review_status: 'needs_review' | 'reviewed' | 'ignored' | null
  }>,
): Promise<SmartRule> {
  return apiFetch<SmartRule>(`/api/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteSmartRule(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/rules/${id}`, { method: 'DELETE' })
}

export function getRuleSuggestions(params: { status?: RuleSuggestion['status'] } = {}): Promise<{ suggestions: RuleSuggestion[] }> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  return apiFetch<{ suggestions: RuleSuggestion[] }>(`/api/rule-suggestions?${q}`)
}

export async function acceptRuleSuggestion(id: string): Promise<{ suggestion: RuleSuggestion; rule: SmartRule }> {
  const res = await apiFetch<{ ok: boolean; suggestion: RuleSuggestion; rule: SmartRule }>(
    `/api/rule-suggestions/${id}/accept`,
    { method: 'POST' },
  )
  return { suggestion: res.suggestion, rule: res.rule }
}

export async function dismissRuleSuggestion(id: string): Promise<RuleSuggestion> {
  const res = await apiFetch<{ ok: boolean; suggestion: RuleSuggestion }>(
    `/api/rule-suggestions/${id}/dismiss`,
    { method: 'POST' },
  )
  return res.suggestion
}

export function getCaptures(params: {
  status?: 'pending' | 'processed' | 'failed' | 'ignored'
  source?: string
  failureKind?: string
  q?: string
  limit?: number
} = {}): Promise<{ captures: CaptureEvent[] }> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.source) q.set('source', params.source)
  if (params.failureKind) q.set('failure_kind', params.failureKind)
  if (params.q) q.set('q', params.q)
  if (params.limit) q.set('limit', String(params.limit))
  return apiFetch<{ captures: CaptureEvent[] }>(`/api/captures?${q}`)
}

export function getCaptureSummary(): Promise<{
  failures: CaptureFailureSummary[]
  statuses: CaptureCountSummary[]
  sources: CaptureCountSummary[]
}> {
  return apiFetch<{
    failures: CaptureFailureSummary[]
    statuses: CaptureCountSummary[]
    sources: CaptureCountSummary[]
  }>('/api/captures/summary')
}

export async function ignoreCapture(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/captures/${id}/ignore`, { method: 'POST' })
}

export async function replayCapture(id: string): Promise<{ expense_id: string }> {
  return apiFetch<{ ok: boolean; expense_id: string }>(`/api/captures/${id}/replay`, {
    method: 'POST',
  })
}

export function getAlerts(params: { includeResolved?: boolean } = {}): Promise<{ alerts: UserAlert[] }> {
  const q = new URLSearchParams()
  if (params.includeResolved !== undefined) q.set('include_resolved', String(params.includeResolved))
  return apiFetch<{ alerts: UserAlert[] }>(`/api/alerts?${q}`)
}

export async function dismissAlert(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/alerts/${id}/dismiss`, { method: 'POST' })
}

export function getReconciliation(params: {
  year: number
  month: number
  accountId?: string
}): Promise<ReconciliationResult> {
  const q = new URLSearchParams()
  q.set('year', String(params.year))
  q.set('month', String(params.month))
  if (params.accountId) q.set('account_id', params.accountId)
  return apiFetch<ReconciliationResult>(`/api/reconciliation/monthly?${q}`)
}

export function getSettlement(params: { year: number; month: number }): Promise<{ settlement: HouseholdSettlement }> {
  const q = new URLSearchParams()
  q.set('year', String(params.year))
  q.set('month', String(params.month))
  return apiFetch<{ settlement: HouseholdSettlement }>(`/api/settlement/monthly?${q}`)
}

export function getRestoreDrills(): Promise<{ drills: RestoreDrill[] }> {
  return apiFetch<{ drills: RestoreDrill[] }>('/api/ops/restore-drills')
}

export async function retryStatement(id: string): Promise<{
  ok: boolean
  rows: StatementImportRow[]
  parsed_count: number
  imported_count: number
  duplicate_count: number
}> {
  return apiFetch<{
    ok: boolean
    rows: StatementImportRow[]
    parsed_count: number
    imported_count: number
    duplicate_count: number
  }>(`/api/statements/${id}/retry`, { method: 'POST' })
}

export function getSubscriptions(params: { includeIgnored?: boolean } = {}): Promise<{
  subscriptions: SubscriptionCandidate[]
  records?: ManagedSubscription[]
  summary?: SubscriptionSummary
}> {
  const q = new URLSearchParams()
  if (params.includeIgnored !== undefined) q.set('include_ignored', String(params.includeIgnored))
  return apiFetch<{
    subscriptions: SubscriptionCandidate[]
    records?: ManagedSubscription[]
    summary?: SubscriptionSummary
  }>(`/api/subscriptions?${q}`)
}

export async function setSubscriptionPreference(
  merchantKey: string,
  merchantName: string,
  status: SubscriptionPreferenceStatus,
): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/subscriptions/${encodeURIComponent(merchantKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchant_name: merchantName, status }),
  })
}

export async function clearSubscriptionPreference(merchantKey: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/subscriptions/${encodeURIComponent(merchantKey)}`, {
    method: 'DELETE',
  })
}

export async function createSubscriptionRecord(input: SubscriptionRecordInput): Promise<{ record: ManagedSubscription }> {
  return apiFetch<{ ok: boolean; record: ManagedSubscription }>('/api/subscriptions/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateSubscriptionRecord(
  id: string,
  input: SubscriptionRecordInput,
): Promise<{ record: ManagedSubscription }> {
  return apiFetch<{ ok: boolean; record: ManagedSubscription }>(`/api/subscriptions/records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function deleteSubscriptionRecord(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/subscriptions/records/${id}`, { method: 'DELETE' })
}

export async function confirmSubscriptionCandidate(
  subscription: SubscriptionCandidate,
  overrides: {
    category_id?: string | null
    account_id?: string | null
    payment_method?: string | null
    notes?: string | null
  } = {},
): Promise<{ record: ManagedSubscription }> {
  return apiFetch<{ ok: boolean; record: ManagedSubscription }>(
    `/api/subscriptions/detections/${encodeURIComponent(subscription.merchant_key)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_name: subscription.name,
        cadence: subscription.cadence,
        amount_cents: Number(subscription.avg_amount_cents),
        currency: subscription.currency,
        next_due_at: subscription.next_expected_at,
        ...overrides,
      }),
    },
  )
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
    cadence?: string
    confidence?: number
    avg_amount_cents?: number
    monthly_estimate_cents?: number
    avg_interval_days?: number | null
    interval_jitter_days?: number | null
    amount_variance_pct?: number
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
