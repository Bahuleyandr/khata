import type { AuditEvent, CaptureCountSummary, CaptureEvent, Ledger, Me, SubscriptionPreferenceStatus, SubscriptionCandidate } from '../../../../lib/api'

export function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function splitMonth(value: string) {
  const [yearRaw, monthRaw] = value.split('-')
  return { year: Number(yearRaw), month: Number(monthRaw) }
}

export function rupeesToCents(value: string) {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [rupees, paise = ''] = cleaned.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

export function formatAuditDate(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function auditLabel(event: AuditEvent) {
  return event.action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' ')
}

export function formatAuditJson(value: unknown) {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value, null, 2) ?? 'null'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatAuditCell(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value) ?? 'null'
  return String(value)
}

export function auditDiff(event: AuditEvent) {
  const before = event.before
  const after = event.after
  if (!isRecord(before) || !isRecord(after)) return []
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  return keys
    .map((key) => ({
      field: key,
      before: before[key],
      after: after[key],
    }))
    .filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after))
}

export function parseTagNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  )
}

export type SubscriptionFilter = 'active' | 'attention' | 'confirmed' | 'ignored' | 'inactive' | 'all'
export type CaptureStatusFilter = 'pending' | 'processed' | 'failed' | 'ignored'
export type AccessPreset = 'partner' | 'viewer' | 'owner'

export const CAPTURE_SOURCES = [
  'telegram_text',
  'telegram_photo',
  'telegram_voice',
  'telegram_document',
  'dashboard_manual',
  'statement_upload',
] as const

export const CAPTURE_FAILURE_KINDS = [
  'no_text',
  'not_receipt',
  'no_transactions',
  'parse_error',
  'ocr_error',
  'duplicate',
  'unsupported_file',
  'oversize',
  'unknown',
] as const

export const AUDIT_ACTION_OPTIONS = [
  'expense.create',
  'expense.update',
  'expense.delete',
  'expense.merge',
  'expense.bulk_update',
  'statement.upload',
  'statement.import',
  'statement.row_update',
  'subscription.create',
  'subscription.update',
  'subscription.delete',
  'subscription.detected_confirm',
  'subscription.preference_set',
  'subscription.preference_clear',
  'access.grant',
  'access.update',
  'access.revoke',
  'capture.ignore',
  'capture.replay',
  'month_close.exported',
  'month_close.close',
  'month_close.reopen',
]

export const AUDIT_ENTITY_OPTIONS = [
  'expense',
  'statement',
  'statement_row',
  'subscription',
  'category',
  'budget',
  'tag',
  'access_user',
  'capture_event',
  'month_close',
  'alert',
]

export const UNDOABLE_AUDIT_ACTIONS = new Set(['expense.create', 'expense.update', 'expense.delete', 'statement.row_update'])

export function canUndoAudit(event: AuditEvent) {
  return UNDOABLE_AUDIT_ACTIONS.has(event.action) && !event.undone_at
}

export function subscriptionTiming(subscription: SubscriptionCandidate) {
  if (subscription.next_expected_at === null || subscription.days_until_next === null) return 'Timing unknown'
  if (subscription.days_until_next < 0) {
    return `Expected ${Math.abs(subscription.days_until_next)} days ago`
  }
  if (subscription.days_until_next === 0) return 'Expected today'
  return `Expected in ${subscription.days_until_next} days`
}

export function subscriptionBadgeClass(status: SubscriptionPreferenceStatus) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'inactive') return 'badge-inactive'
  return 'badge-muted'
}

export function captureLabel(value: string) {
  return value.replace(/_/g, ' ')
}

export function captureRulePattern(capture: CaptureEvent) {
  return (capture.raw_text ?? capture.error_reason ?? capture.source)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function ledgerDisplayName(ledger: Ledger, me: Me | null) {
  const isOwnPersonal = ledger.kind === 'personal' && ledger.owner_telegram_user_id === me?.telegram_user_id
  if (ledger.kind === 'household') return ledger.name === 'Household' ? 'Household' : ledger.name
  if (isOwnPersonal) return ledger.name === 'Personal' ? 'My Ledger' : ledger.name
  return ledger.name === 'Personal' ? `Personal ${ledger.owner_telegram_user_id}` : ledger.name
}

export function ledgerPermissionSummary(item: Ledger | Me) {
  const role = item.can_manage ? 'Owner' : 'Member'
  const access = item.can_add ? 'can add' : 'view only'
  return `${role} · ${access}`
}

export function captureCount(counts: CaptureCountSummary[], key: string) {
  return counts.find((item) => item.key === key)?.count ?? 0
}
