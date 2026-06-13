'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  acceptRuleSuggestion,
  clearBudget,
  clearSubscriptionPreference,
  archiveAccount,
  createCategory,
  createAccount,
  createSmartRule,
  deleteCategory,
  deleteSmartRule,
  dismissRuleSuggestion,
  dismissAlert,
  formatCents,
  formatDate,
  getAccessUsers,
  getAccounts,
  getAlerts,
  getAuditLog,
  getBudgets,
  getCaptures,
  getCaptureSummary,
  getCategories,
  getMe,
  getReconciliation,
  getRestoreDrills,
  getRuleSuggestions,
  getSettlement,
  getSmartRules,
  getStatementRows,
  getStatements,
  getSubscriptions,
  getTags,
  grantAccessUser,
  importStatementRows,
  renameCategory,
  retryStatement,
  revokeAccessUser,
  setBudget,
  setSubscriptionPreference,
  replayCapture,
  ignoreCapture,
  undoAuditEvent,
  updateAccount,
  updateAccessUserRole,
  updateSmartRule,
  updateStatementImportRow,
  uploadStatement,
  type Account,
  type AccountType,
  type AccessRole,
  type AccessUser,
  type AuditEvent,
  type BudgetVariance,
  type CaptureEvent,
  type CaptureFailureSummary,
  type Category,
  type HouseholdSettlement,
  type Me,
  type ReconciliationResult,
  type RestoreDrill,
  type RuleSuggestion,
  type SmartRule,
  type StatementImport,
  type StatementImportRow,
  type SubscriptionCandidate,
  type SubscriptionPreferenceStatus,
  type Tag,
  type UserAlert,
} from '../../../lib/api'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function splitMonth(value: string) {
  const [yearRaw, monthRaw] = value.split('-')
  return { year: Number(yearRaw), month: Number(monthRaw) }
}

function rupeesToCents(value: string) {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [rupees, paise = ''] = cleaned.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

function formatAuditDate(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function auditLabel(event: AuditEvent) {
  return event.action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' ')
}

function formatAuditJson(value: unknown) {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value, null, 2) ?? 'null'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatAuditCell(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value) ?? 'null'
  return String(value)
}

function auditDiff(event: AuditEvent) {
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

function parseTagNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  )
}

type SubscriptionFilter = 'active' | 'attention' | 'confirmed' | 'ignored' | 'inactive' | 'all'

const AUDIT_ACTION_OPTIONS = [
  'expense.create',
  'expense.update',
  'expense.delete',
  'expense.merge',
  'expense.bulk_update',
  'statement.upload',
  'statement.import',
  'statement.row_update',
  'subscription.preference_set',
  'subscription.preference_clear',
  'access.grant',
  'access.update',
  'access.revoke',
]

const AUDIT_ENTITY_OPTIONS = ['expense', 'statement', 'statement_row', 'subscription', 'category', 'budget', 'tag', 'access_user']
const UNDOABLE_AUDIT_ACTIONS = new Set(['expense.create', 'expense.update', 'expense.delete', 'statement.row_update'])

function canUndoAudit(event: AuditEvent) {
  return UNDOABLE_AUDIT_ACTIONS.has(event.action) && !event.undone_at
}

function subscriptionTiming(subscription: SubscriptionCandidate) {
  if (subscription.next_expected_at === null || subscription.days_until_next === null) return 'Timing unknown'
  if (subscription.days_until_next < 0) {
    return `Expected ${Math.abs(subscription.days_until_next)} days ago`
  }
  if (subscription.days_until_next === 0) return 'Expected today'
  return `Expected in ${subscription.days_until_next} days`
}

function subscriptionBadgeClass(status: SubscriptionPreferenceStatus) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'inactive') return 'badge-inactive'
  return 'badge-muted'
}

export default function ManagePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([])
  const [newAccessTelegramId, setNewAccessTelegramId] = useState('')
  const [newAccessName, setNewAccessName] = useState('')
  const [newAccessUsername, setNewAccessUsername] = useState('')
  const [newAccessRole, setNewAccessRole] = useState<AccessRole>('member')
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [budgets, setBudgets] = useState<BudgetVariance[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [alerts, setAlerts] = useState<UserAlert[]>([])
  const [captures, setCaptures] = useState<CaptureEvent[]>([])
  const [captureFailures, setCaptureFailures] = useState<CaptureFailureSummary[]>([])
  const [rules, setRules] = useState<SmartRule[]>([])
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([])
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null)
  const [settlement, setSettlement] = useState<HouseholdSettlement | null>(null)
  const [restoreDrills, setRestoreDrills] = useState<RestoreDrill[]>([])
  const [statements, setStatements] = useState<StatementImport[]>([])
  const [statementRows, setStatementRows] = useState<StatementImportRow[]>([])
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [selectedStatementRowIds, setSelectedStatementRowIds] = useState<string[]>([])
  const [bulkStatementCategory, setBulkStatementCategory] = useState('')
  const [bulkStatementAccount, setBulkStatementAccount] = useState('')
  const [bulkStatementTags, setBulkStatementTags] = useState('')
  const [subscriptions, setSubscriptions] = useState<SubscriptionCandidate[]>([])
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>('active')
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditDetail, setAuditDetail] = useState<AuditEvent | null>(null)
  const [auditLimit, setAuditLimit] = useState(30)
  const [auditAction, setAuditAction] = useState('')
  const [auditEntityType, setAuditEntityType] = useState('')
  const [month, setMonth] = useState(currentMonthValue)
  const [newCategory, setNewCategory] = useState('')
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountType, setNewAccountType] = useState<AccountType>('card')
  const [newAccountInstitution, setNewAccountInstitution] = useState('')
  const [newAccountLastFour, setNewAccountLastFour] = useState('')
  const [newRuleName, setNewRuleName] = useState('')
  const [newRulePattern, setNewRulePattern] = useState('')
  const [newRuleCategory, setNewRuleCategory] = useState('')
  const [newRuleAccount, setNewRuleAccount] = useState('')
  const [newRuleTags, setNewRuleTags] = useState('')
  const [newRuleScope, setNewRuleScope] = useState<'merchant' | 'description' | 'raw_text' | 'any'>('any')
  const [newRuleMatchType, setNewRuleMatchType] = useState<'contains' | 'equals' | 'regex'>('contains')
  const [newRuleReviewStatus, setNewRuleReviewStatus] = useState('')
  const [captureStatus, setCaptureStatus] = useState<'pending' | 'processed' | 'failed' | 'ignored'>('failed')
  const [reconcileAccount, setReconcileAccount] = useState('')
  const [statementAccount, setStatementAccount] = useState('')
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [statementInputKey, setStatementInputKey] = useState(0)
  const [statementUploadResult, setStatementUploadResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    const mePromise = getMe()
    const dataPromises = [
      getCategories(),
      getAccounts(),
      getBudgets(month),
      getTags(),
      getAlerts(),
      getCaptures({ status: captureStatus, limit: 25 }),
      getCaptureSummary(),
      getSmartRules(),
      getRuleSuggestions(),
      getStatements(),
      getSubscriptions({ includeIgnored: true }),
      getAuditLog({
        limit: auditLimit,
        action: auditAction || undefined,
        entityType: auditEntityType || undefined,
      }),
      getReconciliation({
        ...splitMonth(month),
        accountId: reconcileAccount || undefined,
      }),
      getSettlement(splitMonth(month)),
    ] as const
    const meRes = await mePromise
    const [
      cats,
      accountRes,
      budgetRes,
      tagRes,
      alertRes,
      captureRes,
      captureSummaryRes,
      ruleRes,
      suggestionRes,
      statementRes,
      subscriptionRes,
      auditRes,
      reconciliationRes,
      settlementRes,
      accessRes,
      restoreDrillRes,
    ] = await Promise.all([
      ...dataPromises,
      meRes.can_manage ? getAccessUsers() : Promise.resolve({ users: [] }),
      meRes.can_manage ? getRestoreDrills() : Promise.resolve({ drills: [] }),
    ])
    setMe(meRes)
    setAccessUsers(accessRes.users)
    setCategories(cats)
    setAccounts(accountRes.accounts)
    setBudgets(budgetRes.budgets)
    setTags(tagRes.tags)
    setAlerts(alertRes.alerts)
    setCaptures(captureRes.captures)
    setCaptureFailures(captureSummaryRes.failures ?? [])
    setRules(ruleRes.rules)
    setSuggestions(suggestionRes.suggestions)
    setStatements(statementRes.statements)
    setSubscriptions(subscriptionRes.subscriptions)
    setAuditEvents(auditRes.events)
    setReconciliation(reconciliationRes)
    setSettlement(settlementRes.settlement)
    setRestoreDrills(restoreDrillRes.drills)
    setBudgetCategory((current) => current || cats[0]?.id || '')
  }, [auditAction, auditEntityType, auditLimit, captureStatus, month, reconcileAccount])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const pendingStatementRows = statementRows.filter((row) => row.status === 'pending')
  const selectedPendingRowIds = selectedStatementRowIds.filter((id) =>
    pendingStatementRows.some((row) => row.id === id),
  )
  const activeSubscriptions = subscriptions.filter(
    (subscription) => !['ignored', 'inactive'].includes(subscription.preference_status ?? ''),
  )
  const attentionSubscriptions = activeSubscriptions.filter(
    (subscription) => subscription.is_overdue || subscription.not_seen_this_month,
  )
  const confirmedSubscriptions = subscriptions.filter((subscription) => subscription.preference_status === 'confirmed')
  const subscriptionMonthlyTotal = (
    confirmedSubscriptions.length > 0 ? confirmedSubscriptions : activeSubscriptions
  ).reduce((sum, subscription) => sum + Number(subscription.monthly_estimate_cents), 0)
  const filteredSubscriptions = subscriptions.filter((subscription) => {
    if (subscriptionFilter === 'all') return true
    if (subscriptionFilter === 'active') return !['ignored', 'inactive'].includes(subscription.preference_status ?? '')
    if (subscriptionFilter === 'attention') return subscription.is_overdue || subscription.not_seen_this_month
    return subscription.preference_status === subscriptionFilter
  })
  const auditActions = useMemo(
    () => Array.from(new Set([...AUDIT_ACTION_OPTIONS, ...auditEvents.map((event) => event.action)])).sort(),
    [auditEvents],
  )
  const auditEntityTypes = useMemo(
    () => Array.from(new Set([...AUDIT_ENTITY_OPTIONS, ...auditEvents.map((event) => event.entity_type)])).sort(),
    [auditEvents],
  )

  async function loadStatementReview(statementId: string) {
    const res = await getStatementRows(statementId)
    setSelectedStatementId(statementId)
    setStatementRows(res.rows)
    setSelectedStatementRowIds(res.rows.filter((row) => row.status === 'pending').map((row) => row.id))
  }

  function toggleStatementRow(rowId: string, checked: boolean) {
    setSelectedStatementRowIds((ids) =>
      checked ? Array.from(new Set([...ids, rowId])) : ids.filter((id) => id !== rowId),
    )
  }

  async function importSelectedRows(rowIds?: string[]) {
    if (!selectedStatementId) return
    const result = await importStatementRows(selectedStatementId, rowIds)
    setStatementUploadResult(`${result.imported_count} imported from reviewed statement rows`)
    await loadStatementReview(selectedStatementId)
  }

  async function ignoreSelectedRows() {
    if (!selectedStatementId || selectedPendingRowIds.length === 0) return
    await Promise.all(
      selectedPendingRowIds.map((rowId) => updateStatementImportRow(selectedStatementId, rowId, { status: 'ignored' })),
    )
    await loadStatementReview(selectedStatementId)
  }

  async function restoreStatementRow(rowId: string) {
    if (!selectedStatementId) return
    await updateStatementImportRow(selectedStatementId, rowId, { status: 'pending' })
    await loadStatementReview(selectedStatementId)
  }

  async function saveStatementRowCorrection(
    rowId: string,
    data: { category_id: string | null; account_id?: string | null; tag_names: string[] },
  ) {
    if (!selectedStatementId) return
    await updateStatementImportRow(selectedStatementId, rowId, data)
    await loadStatementReview(selectedStatementId)
  }

  async function createNewAccount() {
    if (!newAccountName.trim()) return
    await createAccount({
      name: newAccountName,
      type: newAccountType,
      institution: newAccountInstitution.trim() || null,
      last_four: newAccountLastFour.trim() || null,
      is_default: accounts.length === 0,
    })
    setNewAccountName('')
    setNewAccountInstitution('')
    setNewAccountLastFour('')
  }

  async function createNewRule() {
    if (!newRuleName.trim() || !newRulePattern.trim()) return
    await createSmartRule({
      name: newRuleName,
      pattern: newRulePattern,
      match_scope: newRuleScope,
      match_type: newRuleMatchType,
      category_id: newRuleCategory || null,
      account_id: newRuleAccount || null,
      tag_names: parseTagNames(newRuleTags),
      review_status: newRuleReviewStatus ? (newRuleReviewStatus as 'needs_review' | 'reviewed' | 'ignored') : null,
    })
    setNewRuleName('')
    setNewRulePattern('')
    setNewRuleTags('')
  }

  async function acceptSuggestion(suggestionId: string) {
    await acceptRuleSuggestion(suggestionId)
  }

  async function dismissSuggestion(suggestionId: string) {
    await dismissRuleSuggestion(suggestionId)
  }

  async function replayRawCapture(captureId: string) {
    await replayCapture(captureId)
  }

  async function undoAudit(auditId: string) {
    const event = await undoAuditEvent(auditId)
    setAuditDetail(event)
  }

  async function applyCorrectionsToSelected() {
    if (!selectedStatementId || selectedPendingRowIds.length === 0) return
    const body: { category_id?: string | null; account_id?: string | null; tag_names?: string[] } = {}
    if (bulkStatementCategory === '__none__') body.category_id = null
    else if (bulkStatementCategory) body.category_id = bulkStatementCategory
    if (bulkStatementAccount === '__none__') body.account_id = null
    else if (bulkStatementAccount) body.account_id = bulkStatementAccount
    if (bulkStatementTags.trim()) body.tag_names = parseTagNames(bulkStatementTags)
    if (!Object.keys(body).length) {
      throw new Error('Choose a category, account, or enter tags to apply.')
    }
    await Promise.all(
      selectedPendingRowIds.map((rowId) => updateStatementImportRow(selectedStatementId, rowId, body)),
    )
    setBulkStatementCategory('')
    setBulkStatementAccount('')
    setBulkStatementTags('')
    await loadStatementReview(selectedStatementId)
  }

  async function reparseStatement(statementId: string) {
    const result = await retryStatement(statementId)
    setStatementUploadResult(
      `${result.parsed_count} parsed for review · ${result.duplicate_count} duplicates`,
    )
    setSelectedStatementId(statementId)
    setStatementRows(result.rows)
    setSelectedStatementRowIds(result.rows.filter((row) => row.status === 'pending').map((row) => row.id))
  }

  async function updateSubscription(subscription: SubscriptionCandidate, status: SubscriptionPreferenceStatus) {
    await setSubscriptionPreference(subscription.merchant_key, subscription.name, status)
  }

  async function addAccessUser() {
    const telegramId = newAccessTelegramId.trim()
    if (!telegramId) return
    await grantAccessUser({
      telegram_user_id: telegramId,
      first_name: newAccessName.trim() || undefined,
      username: newAccessUsername.trim().replace(/^@/, '') || undefined,
      role: newAccessRole,
      can_view: true,
      can_add: true,
    })
    setNewAccessTelegramId('')
    setNewAccessName('')
    setNewAccessUsername('')
    setNewAccessRole('member')
  }

  async function changeAccessUser(
    user: AccessUser,
    data: { role?: AccessRole; can_view?: boolean; can_add?: boolean },
  ) {
    await updateAccessUserRole(user.telegram_user_id, data)
  }

  async function revokeAccess(user: AccessUser) {
    await revokeAccessUser(user.telegram_user_id)
  }

  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    await createCategory(name)
    setNewCategory('')
  }

  async function saveBudget() {
    const cents = rupeesToCents(budgetAmount)
    if (!budgetCategory || !cents) {
      setError('Choose a category and enter a valid amount.')
      return
    }
    await setBudget(budgetCategory, cents)
    setBudgetAmount('')
  }

  async function uploadSelectedStatement() {
    if (!statementFile) {
      setError('Choose a PDF or statement image first.')
      return
    }
    const result = await uploadStatement(statementFile, statementAccount || undefined)
    setStatementUploadResult(
      `${result.parsed_count} parsed for review · ${result.duplicate_count} duplicates`,
    )
    setSelectedStatementId(result.statement.id)
    setStatementRows(result.rows)
    setSelectedStatementRowIds(result.rows.filter((row) => row.status === 'pending').map((row) => row.id))
    setStatementFile(null)
    setStatementInputKey((key) => key + 1)
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Manage</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Budget month" />
      </div>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="grid-2">
        <section className="card workspace-card wide-card">
          <h3>Ledger Access</h3>
          <div className="access-summary-grid">
            <span>
              <strong>{me?.telegram_user_id ?? '...'}</strong>
              <small>Your Telegram ID</small>
            </span>
            <span>
              <strong>{me?.selected_ledger_name ?? '...'}</strong>
              <small>{me?.selected_ledger_kind === 'household' ? 'Shared ledger' : 'Personal ledger'}</small>
            </span>
            <span>
              <strong>{me?.role ?? '...'}</strong>
              <small>Your role</small>
            </span>
          </div>
          {me?.can_manage ? (
            <>
              <p className="muted-copy access-note">
                Access changes apply only to the selected ledger in the top navigation.
              </p>
              <div className="inline-form access-form">
                <input
                  inputMode="numeric"
                  value={newAccessTelegramId}
                  onChange={(e) => setNewAccessTelegramId(e.target.value)}
                  placeholder="Telegram user ID"
                  aria-label="Telegram user ID"
                />
                <input
                  value={newAccessName}
                  onChange={(e) => setNewAccessName(e.target.value)}
                  placeholder="Display name"
                  aria-label="Access display name"
                />
                <input
                  value={newAccessUsername}
                  onChange={(e) => setNewAccessUsername(e.target.value)}
                  placeholder="@username"
                  aria-label="Telegram username"
                />
                <select
                  value={newAccessRole}
                  onChange={(e) => setNewAccessRole(e.target.value as AccessRole)}
                  aria-label="Access role"
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
                <button type="button" onClick={() => void run(addAccessUser)} disabled={busy || !newAccessTelegramId.trim()}>
                  Add
                </button>
              </div>
              <div className="statement-list">
                {accessUsers.length === 0 ? <p>No access users yet.</p> : accessUsers.map((user) => (
                  <AccessUserRow
                    key={user.telegram_user_id}
                    user={user}
                    me={me}
                    busy={busy}
                    onChange={(data) => run(() => changeAccessUser(user, data))}
                    onRevoke={() => run(() => revokeAccess(user))}
                    onReactivate={() => run(() => grantAccessUser({
                      telegram_user_id: user.telegram_user_id,
                      first_name: user.first_name,
                      username: user.username,
                      role: user.role,
                      can_view: true,
                      can_add: user.can_add,
                    }).then(() => undefined))}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="muted-copy">Only ledger owners can add, remove, or change visibility.</p>
          )}
        </section>

        <section className="card workspace-card">
          <h3>Alerts</h3>
          <div className="statement-list">
            {alerts.length === 0 ? <p>No open alerts.</p> : alerts.map((alert) => (
              <div key={alert.id} className="statement-row">
                <div>
                  <strong>{alert.title} <span className={`badge badge-${alert.severity}`}>{alert.severity}</span></strong>
                  <span>{alert.detail}</span>
                </div>
                <div className="row-actions">
                  {alert.href ? <a href={alert.href}>Open</a> : null}
                  <button type="button" onClick={() => void run(() => dismissAlert(alert.id))} disabled={busy}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Accounts</h3>
          <div className="inline-form">
            <input value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="AmEx Platinum" />
            <select value={newAccountType} onChange={(e) => setNewAccountType(e.target.value as AccountType)}>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
              <option value="upi">UPI</option>
              <option value="wallet">Wallet</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
            <input value={newAccountInstitution} onChange={(e) => setNewAccountInstitution(e.target.value)} placeholder="Institution" />
            <input value={newAccountLastFour} onChange={(e) => setNewAccountLastFour(e.target.value)} placeholder="Last 4" />
            <button type="button" onClick={() => void run(createNewAccount)} disabled={busy || !newAccountName.trim()}>Add</button>
          </div>
          <div className="statement-list">
            {accounts.length === 0 ? <p>No accounts yet.</p> : accounts.map((account) => (
              <div key={account.id} className="statement-row">
                <div>
                  <strong>{account.name} {account.is_default ? <span className="badge badge-confirmed">default</span> : null}</strong>
                  <span>{account.type}{account.institution ? ` · ${account.institution}` : ''}{account.last_four ? ` · **${account.last_four}` : ''}</span>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void run(() => updateAccount(account.id, { is_default: true }).then(() => undefined))} disabled={busy || account.is_default}>
                    Default
                  </button>
                  <button type="button" className="danger" onClick={() => void run(() => archiveAccount(account.id))} disabled={busy}>
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card wide-card">
          <h3>Monthly Reconciliation</h3>
          <div className="inline-form">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <select value={reconcileAccount} onChange={(e) => setReconcileAccount(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
            <button type="button" onClick={() => void run(async () => undefined)} disabled={busy}>Refresh</button>
          </div>
          {reconciliation ? (
            <>
              <div className="summary-grid compact-summary">
                <span><strong>{reconciliation.summary.matched_count}</strong><small>matched</small></span>
                <span><strong>{reconciliation.summary.missing_in_khata}</strong><small>missing in Khata</small></span>
                <span><strong>{reconciliation.summary.missing_in_statement}</strong><small>missing in statement</small></span>
                <span><strong>{reconciliation.summary.amount_mismatch}</strong><small>amount mismatch</small></span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Account</th>
                      <th style={{ textAlign: 'right' }}>Khata</th>
                      <th style={{ textAlign: 'right' }}>Statement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.items.slice(0, 20).map((item) => (
                      <tr key={`${item.status}-${item.expense_id ?? item.statement_row_id}`}>
                        <td><span className={`badge badge-${item.status}`}>{item.status.replace(/_/g, ' ')}</span></td>
                        <td>{formatDate(item.occurred_at)}</td>
                        <td>{item.description}</td>
                        <td>{item.account ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>{formatCents(item.amount_cents, item.currency)}</td>
                        <td style={{ textAlign: 'right' }}>{item.statement_amount_cents ? formatCents(item.statement_amount_cents, item.currency) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p>No reconciliation loaded.</p>}
        </section>

        <section className="card workspace-card">
          <h3>Household Settlement</h3>
          {me?.selected_ledger_kind !== 'household' ? (
            <p className="muted-copy">Switch to the Household ledger to see shared settlement.</p>
          ) : settlement ? (
            <>
              <div className="summary-grid compact-summary">
                <span><strong>{formatCents(settlement.total_cents)}</strong><small>shared spend</small></span>
                <span><strong>{settlement.member_count}</strong><small>members</small></span>
                <span><strong>{settlement.transfers.length}</strong><small>settle-ups</small></span>
              </div>
              <div className="statement-list">
                {settlement.payers.map((payer) => (
                  <div key={payer.telegram_user_id} className="statement-row">
                    <div>
                      <strong>{payer.first_name ?? payer.username ?? payer.telegram_user_id}</strong>
                      <span>Paid {formatCents(payer.paid_cents)} · share {formatCents(payer.fair_share_cents)}</span>
                    </div>
                    <span className={Number(payer.balance_cents) >= 0 ? 'positive-amount' : 'negative-amount'}>
                      {formatCents(Math.abs(Number(payer.balance_cents)))}
                    </span>
                  </div>
                ))}
                {settlement.transfers.length === 0 ? <p>No settlement transfer needed.</p> : settlement.transfers.map((transfer) => (
                  <div key={`${transfer.from_telegram_user_id}-${transfer.to_telegram_user_id}`} className="statement-row">
                    <div>
                      <strong>{transfer.from_telegram_user_id} pays {transfer.to_telegram_user_id}</strong>
                      <span>{formatCents(transfer.amount_cents)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <p>No settlement loaded.</p>}
        </section>

        <section className="card workspace-card wide-card">
          <h3>Smart Rules</h3>
          <div className="inline-form">
            <input value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="Rule name" />
            <select value={newRuleScope} onChange={(e) => setNewRuleScope(e.target.value as typeof newRuleScope)}>
              <option value="any">Any field</option>
              <option value="merchant">Merchant</option>
              <option value="description">Description</option>
              <option value="raw_text">Raw text</option>
            </select>
            <select value={newRuleMatchType} onChange={(e) => setNewRuleMatchType(e.target.value as typeof newRuleMatchType)}>
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="regex">Regex</option>
            </select>
            <input value={newRulePattern} onChange={(e) => setNewRulePattern(e.target.value)} placeholder="Pattern" />
            <select value={newRuleCategory} onChange={(e) => setNewRuleCategory(e.target.value)}>
              <option value="">Keep category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select value={newRuleAccount} onChange={(e) => setNewRuleAccount(e.target.value)}>
              <option value="">Keep account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
            <input value={newRuleTags} onChange={(e) => setNewRuleTags(e.target.value)} placeholder="tags" />
            <select value={newRuleReviewStatus} onChange={(e) => setNewRuleReviewStatus(e.target.value)}>
              <option value="">Keep review</option>
              <option value="reviewed">Reviewed</option>
              <option value="needs_review">Needs review</option>
              <option value="ignored">Ignored</option>
            </select>
            <button type="button" onClick={() => void run(createNewRule)} disabled={busy || !newRuleName.trim() || !newRulePattern.trim()}>Add</button>
          </div>
          <div className="statement-list">
            {rules.length === 0 ? <p>No rules yet.</p> : rules.map((rule) => (
              <div key={rule.id} className="statement-row">
                <div>
                  <strong>{rule.name} <span className="badge badge-muted">{rule.match_scope}:{rule.match_type}</span></strong>
                  <span>{rule.pattern} · {rule.category ?? 'category unchanged'} · {rule.account ?? 'account unchanged'} · {rule.tag_names.join(', ') || 'no tags'}</span>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void run(() => updateSmartRule(rule.id, { enabled: !rule.enabled }).then(() => undefined))} disabled={busy}>
                    {rule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="danger" onClick={() => void run(() => deleteSmartRule(rule.id))} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card wide-card">
          <h3>Learning Suggestions</h3>
          <div className="statement-list">
            {suggestions.length === 0 ? <p>No pending suggestions.</p> : suggestions.map((suggestion) => (
              <div key={suggestion.id} className="statement-row">
                <div>
                  <strong>
                    {suggestion.pattern}
                    <span className="badge badge-muted">{suggestion.source.replace(/_/g, ' ')}</span>
                  </strong>
                  <span>
                    {suggestion.category ?? 'category unchanged'} · {suggestion.account ?? 'account unchanged'}
                    {suggestion.tag_names.length ? ` · ${suggestion.tag_names.map((tag) => `#${tag}`).join(' ')}` : ''}
                  </span>
                  <small>{suggestion.reason}</small>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void run(() => acceptSuggestion(suggestion.id))} disabled={busy}>
                    Accept
                  </button>
                  <button type="button" onClick={() => void run(() => dismissSuggestion(suggestion.id))} disabled={busy}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card wide-card" id="capture-inbox">
          <h3>Raw Capture Inbox</h3>
          <div className="inline-form">
            <select value={captureStatus} onChange={(e) => setCaptureStatus(e.target.value as typeof captureStatus)}>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
              <option value="ignored">Ignored</option>
            </select>
          </div>
          {captureFailures.length > 0 ? (
            <div className="failure-summary-grid">
              {captureFailures.map((failure) => (
                <span key={failure.failure_kind}>
                  <strong>{failure.count}</strong>
                  <small>{failure.failure_kind.replace(/_/g, ' ')}</small>
                </span>
              ))}
            </div>
          ) : null}
          <div className="statement-list">
            {captures.length === 0 ? <p>No captures for this filter.</p> : captures.map((capture) => (
              <div key={capture.id} className="statement-row capture-row">
                <div>
                  <strong>
                    {capture.source}
                    <span className={`badge badge-${capture.status}`}>{capture.status}</span>
                    {capture.failure_kind ? <span className="badge badge-muted">{capture.failure_kind.replace(/_/g, ' ')}</span> : null}
                  </strong>
                  <span>{capture.error_reason ?? capture.parsed_expense_label ?? 'No detail'}</span>
                  {typeof capture.confidence?.overall === 'number' ? <small>Confidence {capture.confidence.overall}%</small> : null}
                  {capture.raw_text ? <small>{capture.raw_text.slice(0, 240)}</small> : null}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => void run(() => replayRawCapture(capture.id))} disabled={busy || !capture.raw_text || capture.status === 'processed'}>
                    Replay
                  </button>
                  <button type="button" onClick={() => void run(() => ignoreCapture(capture.id))} disabled={busy || capture.status === 'ignored' || capture.status === 'processed'}>
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Categories</h3>
          <div className="inline-form">
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category" />
            <button type="button" onClick={() => void run(addCategory)} disabled={busy}>Add</button>
          </div>
          <div className="stack-list">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                busy={busy}
                onRename={(name) => run(() => renameCategory(category.id, name).then(() => undefined))}
                onDelete={() => run(() => deleteCategory(category.id))}
              />
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Budgets</h3>
          <div className="inline-form">
            <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <input
              inputMode="decimal"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="Monthly budget"
            />
            <button type="button" onClick={() => void run(saveBudget)} disabled={busy}>Set</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Spent</th>
                <th style={{ textAlign: 'right' }}>Target</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {budgets.length === 0 ? (
                <tr><td colSpan={4}>No budgets yet.</td></tr>
              ) : budgets.map((budget) => (
                <tr key={budget.id}>
                  <td>{budget.category_name}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.spent_cents)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCents(budget.target_cents)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" onClick={() => void run(() => clearBudget(budget.category_id))} disabled={busy}>
                      Clear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card workspace-card">
          <h3>Tags</h3>
          <div className="tag-cloud">
            {tags.length === 0 ? <span>No tags yet.</span> : tags.map((tag) => (
              <span key={tag.id}>#{tag.name} · {tag.count}</span>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Subscriptions</h3>
          <div className="subscription-summary-grid">
            <span>
              <strong>{formatCents(subscriptionMonthlyTotal)}</strong>
              <small>monthly watch</small>
            </span>
            <span>
              <strong>{confirmedSubscriptions.length}</strong>
              <small>confirmed</small>
            </span>
            <span>
              <strong>{attentionSubscriptions.length}</strong>
              <small>need attention</small>
            </span>
          </div>
          <div className="segmented-control subscription-filter" aria-label="Subscription filter">
            {([
              ['active', `Active ${activeSubscriptions.length}`],
              ['attention', `Attention ${attentionSubscriptions.length}`],
              ['confirmed', `Confirmed ${confirmedSubscriptions.length}`],
              ['ignored', 'Ignored'],
              ['inactive', 'Inactive'],
              ['all', 'All'],
            ] as Array<[SubscriptionFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={subscriptionFilter === value ? 'active' : ''}
                onClick={() => setSubscriptionFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="statement-list">
            {filteredSubscriptions.length === 0 ? <p>No recurring signals in this view.</p> : filteredSubscriptions.map((subscription) => (
              <div key={subscription.merchant_key} className="statement-row subscription-row">
                <div>
                  <strong>
                    {subscription.name}
                    {subscription.preference_status ? (
                      <span className={`badge ${subscriptionBadgeClass(subscription.preference_status)}`}>
                        {subscription.preference_status}
                      </span>
                    ) : null}
                    {subscription.is_overdue ? <span className="badge badge-review">Overdue</span> : null}
                  </strong>
                  <span>
                    {subscription.cadence} · {formatCents(subscription.monthly_estimate_cents)} / mo · {subscription.confidence}% · {subscription.count} charges
                  </span>
                  <small>
                    {subscriptionTiming(subscription)}
                    {subscription.last_seen ? ` · Last ${formatDate(subscription.last_seen)}` : ''}
                    {subscription.not_seen_this_month ? ' · Not seen this month' : ''}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'confirmed'))}
                    disabled={busy || subscription.preference_status === 'confirmed'}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'ignored'))}
                    disabled={busy || subscription.preference_status === 'ignored'}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => updateSubscription(subscription, 'inactive'))}
                    disabled={busy || subscription.preference_status === 'inactive'}
                  >
                    Inactive
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => clearSubscriptionPreference(subscription.merchant_key))}
                    disabled={busy || !subscription.preference_status}
                  >
                    Clear
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card">
          <h3>Statement Imports</h3>
          <div className="statement-upload-panel">
            <input
              key={statementInputKey}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                setStatementFile(e.target.files?.[0] ?? null)
                setStatementUploadResult(null)
              }}
              aria-label="Statement file"
            />
            <select
              value={statementAccount}
              onChange={(e) => setStatementAccount(e.target.value)}
              aria-label="Statement account"
            >
              <option value="">Detect account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="button-primary"
              onClick={() => void run(uploadSelectedStatement)}
              disabled={busy || !statementFile}
            >
              Upload
            </button>
            {statementUploadResult ? <span>{statementUploadResult}</span> : null}
          </div>
          <div className="statement-list">
            {statements.length === 0 ? <p>No statement imports yet.</p> : statements.map((statement) => (
              <div key={statement.id} className="statement-row">
                <div>
                  <strong>{statement.status}</strong>
                  <span>
                    {statement.parsed_count} parsed · {statement.imported_count} imported · {statement.duplicate_count} duplicates
                  </span>
                  {statement.error_reason ? <small>{statement.error_reason}</small> : null}
                  {statement.account ? <small>Account: {statement.account}</small> : null}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => void run(() => loadStatementReview(statement.id))}
                    disabled={busy}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => reparseStatement(statement.id))}
                    disabled={busy || !['failed', 'parsed'].includes(statement.status)}
                  >
                    Re-parse
                  </button>
                </div>
              </div>
            ))}
          </div>
          {selectedStatementId ? (
            <div className="statement-review-panel">
              <div className="statement-review-toolbar">
                <div>
                  <strong>Import Review</strong>
                  <span>{pendingStatementRows.length} pending · {statementRows.length} total rows</span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => setSelectedStatementRowIds(pendingStatementRows.map((row) => row.id))}
                    disabled={busy || pendingStatementRows.length === 0}
                  >
                    Select pending
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => importSelectedRows(selectedPendingRowIds))}
                    disabled={busy || selectedPendingRowIds.length === 0}
                  >
                    Import selected
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => importSelectedRows())}
                    disabled={busy || pendingStatementRows.length === 0}
                  >
                    Import all
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(ignoreSelectedRows)}
                    disabled={busy || selectedPendingRowIds.length === 0}
                  >
                    Ignore selected
                  </button>
                </div>
              </div>
              <div className="statement-correction-bar">
                <select
                  value={bulkStatementCategory}
                  onChange={(e) => setBulkStatementCategory(e.target.value)}
                  aria-label="Bulk statement category"
                >
                  <option value="">Keep category</option>
                  <option value="__none__">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <input
                  value={bulkStatementTags}
                  onChange={(e) => setBulkStatementTags(e.target.value)}
                  placeholder="Tags: travel, reimbursable"
                  aria-label="Bulk statement tags"
                />
                <select
                  value={bulkStatementAccount}
                  onChange={(e) => setBulkStatementAccount(e.target.value)}
                  aria-label="Bulk statement account"
                >
                  <option value="">Keep account</option>
                  <option value="__none__">No account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void run(applyCorrectionsToSelected)}
                  disabled={busy || selectedPendingRowIds.length === 0}
                >
                  Apply to selected
                </button>
              </div>
              <div className="table-scroll">
                <table className="statement-review-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Suggested</th>
                      <th>Category</th>
                      <th>Account</th>
                      <th>Tags</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statementRows.length === 0 ? (
                      <tr><td colSpan={10}>No parsed rows for this statement.</td></tr>
                    ) : statementRows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Select">
                          <input
                            type="checkbox"
                            checked={selectedStatementRowIds.includes(row.id)}
                            onChange={(e) => toggleStatementRow(row.id, e.target.checked)}
                            disabled={row.status !== 'pending'}
                            aria-label={`Select ${row.description}`}
                          />
                        </td>
                        <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.occurred_at)}</td>
                        <td data-label="Description">{row.description}</td>
                        <td data-label="Suggested">{row.suggested_category ?? '—'}</td>
                        <td data-label="Category">{row.category ?? 'Uncategorized'}</td>
                        <td data-label="Account">{row.account ?? '—'}</td>
                        <td data-label="Tags">{row.tag_names.length ? row.tag_names.map((tag) => `#${tag}`).join(' ') : '—'}</td>
                        <td data-label="Status"><span className={`badge badge-${row.status}`}>{row.status}</span></td>
                        <td data-label="Amount" style={{ textAlign: 'right', fontWeight: 600 }}>{formatCents(row.amount_cents, row.currency)}</td>
                        <td data-label="Actions">
                          <div className="row-actions">
                            {row.status === 'pending' ? (
                              <StatementRowCorrection
                                row={row}
                                categories={categories}
                                accounts={accounts}
                                busy={busy}
                                onSave={(data) => run(() => saveStatementRowCorrection(row.id, data))}
                              />
                            ) : null}
                            {row.status === 'ignored' ? (
                              <button
                                type="button"
                                onClick={() => void run(() => restoreStatementRow(row.id))}
                                disabled={busy}
                              >
                                Restore
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card workspace-card wide-card">
          <h3>Restore Drills</h3>
          <div className="statement-list">
            {!me?.can_manage ? <p>Owner access required.</p> : restoreDrills.length === 0 ? <p>No restore drills recorded yet.</p> : restoreDrills.map((drill) => (
              <div key={drill.id} className="statement-row">
                <div>
                  <strong>
                    {drill.status}
                    <span className={`badge badge-${drill.status}`}>{drill.status}</span>
                  </strong>
                  <span>{drill.backup_key ?? 'No backup key recorded'} · {formatAuditDate(drill.checked_at)}</span>
                  {drill.error_reason ? <small>{drill.error_reason}</small> : null}
                </div>
                <span>{drill.duration_ms ? `${Math.round(drill.duration_ms / 1000)}s` : '—'}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card workspace-card wide-card">
          <h3>Audit Trail</h3>
          <div className="audit-filter-bar">
            <select
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              aria-label="Audit action"
            >
              <option value="">All actions</option>
              {auditActions.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
            <select
              value={auditEntityType}
              onChange={(e) => setAuditEntityType(e.target.value)}
              aria-label="Audit entity type"
            >
              <option value="">All entities</option>
              {auditEntityTypes.map((entityType) => (
                <option key={entityType} value={entityType}>{entityType}</option>
              ))}
            </select>
            <select
              value={auditLimit}
              onChange={(e) => setAuditLimit(Number(e.target.value))}
              aria-label="Audit limit"
            >
              {[30, 50, 100].map((limit) => (
                <option key={limit} value={limit}>{limit} events</option>
              ))}
            </select>
          </div>
          <div className="statement-list">
            {auditEvents.length === 0 ? <p>No corrections recorded yet.</p> : auditEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                className="statement-row audit-row"
                onClick={() => setAuditDetail(event)}
              >
                <div>
                  <strong>{auditLabel(event)}</strong>
                  <span>
                    {event.entity_type}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ''} · {formatAuditDate(event.created_at)}
                  </span>
                  {event.undone_at ? <small>Undone {formatAuditDate(event.undone_at)}</small> : null}
                </div>
                <span>{canUndoAudit(event) ? 'Undo available' : 'Details'}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {auditDetail ? (
        <div className="modal-overlay">
          <div className="modal audit-detail-modal" role="dialog" aria-modal="true" aria-label="Audit Event">
            <h3>{auditLabel(auditDetail)}</h3>
            <p>
              {auditDetail.entity_type}
              {auditDetail.entity_id ? ` · ${auditDetail.entity_id}` : ''}
              {' · '}
              {formatAuditDate(auditDetail.created_at)}
            </p>
            {auditDiff(auditDetail).length > 0 ? (
              <section className="audit-diff">
                <h4>Changed Fields</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditDiff(auditDetail).map((row) => (
                      <tr key={row.field}>
                        <td>{row.field}</td>
                        <td>{formatAuditCell(row.before)}</td>
                        <td>{formatAuditCell(row.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            <div className="audit-json-grid">
              <section>
                <h4>Before</h4>
                <pre>{formatAuditJson(auditDetail.before)}</pre>
              </section>
              <section>
                <h4>After</h4>
                <pre>{formatAuditJson(auditDetail.after)}</pre>
              </section>
              <section>
                <h4>Metadata</h4>
                <pre>{formatAuditJson(auditDetail.metadata)}</pre>
              </section>
            </div>
            <div className="modal-actions">
              {canUndoAudit(auditDetail) ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void run(() => undoAudit(auditDetail.id))}
                  disabled={busy}
                >
                  Undo change
                </button>
              ) : null}
              <button type="button" onClick={() => setAuditDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AccessUserRow({
  user,
  me,
  busy,
  onChange,
  onRevoke,
  onReactivate,
}: {
  user: AccessUser
  me: Me
  busy: boolean
  onChange: (data: { role?: AccessRole; can_view?: boolean; can_add?: boolean }) => Promise<void>
  onRevoke: () => Promise<void>
  onReactivate: () => Promise<void>
}) {
  const isProtectedOwner = user.telegram_user_id === user.ledger_id || me.telegram_user_id === user.telegram_user_id
  const name = user.first_name || user.username || `Telegram ${user.telegram_user_id}`
  const username = user.username ? `@${user.username.replace(/^@/, '')}` : null

  return (
    <div className="statement-row access-row">
      <div>
        <strong>
          {name}
          <span className={`badge badge-${user.status}`}>{user.status}</span>
          {me.telegram_user_id === user.telegram_user_id ? <span className="badge badge-muted">you</span> : null}
          {user.can_view ? null : <span className="badge badge-muted">hidden</span>}
        </strong>
        <span>
          {user.telegram_user_id}
          {username ? ` · ${username}` : ''}
          {` · ${user.can_add ? 'can add' : 'view only'}`}
          {user.last_login_at ? ` · Last login ${formatDate(user.last_login_at)}` : ''}
        </span>
      </div>
      <div className="row-actions">
        <select
          value={user.role}
          onChange={(e) => void onChange({ role: e.target.value as AccessRole })}
          disabled={busy || isProtectedOwner || user.status !== 'active'}
          aria-label={`Role for ${name}`}
        >
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </select>
        <label className="access-toggle">
          <input
            type="checkbox"
            checked={user.can_view}
            onChange={(e) => void onChange({ can_view: e.target.checked })}
            disabled={busy || isProtectedOwner || user.status !== 'active'}
          />
          View
        </label>
        <label className="access-toggle">
          <input
            type="checkbox"
            checked={user.can_add}
            onChange={(e) => void onChange({ can_add: e.target.checked })}
            disabled={busy || isProtectedOwner || user.status !== 'active' || !user.can_view}
          />
          Add
        </label>
        {user.status === 'revoked' ? (
          <button type="button" onClick={() => void onReactivate()} disabled={busy}>
            Re-activate
          </button>
        ) : (
          <button type="button" className="danger" onClick={() => void onRevoke()} disabled={busy || isProtectedOwner}>
            Revoke
          </button>
        )}
      </div>
    </div>
  )
}

function CategoryRow({
  category,
  busy,
  onRename,
  onDelete,
}: {
  category: Category
  busy: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(category.name)

  useEffect(() => setName(category.name), [category.name])

  return (
    <div className="list-row">
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => void onRename(name)} disabled={busy || name.trim() === category.name}>
        Rename
      </button>
      <button type="button" onClick={() => void onDelete()} disabled={busy || category.is_default}>
        Delete
      </button>
    </div>
  )
}

function StatementRowCorrection({
  row,
  categories,
  accounts,
  busy,
  onSave,
}: {
  row: StatementImportRow
  categories: Category[]
  accounts: Account[]
  busy: boolean
  onSave: (data: { category_id: string | null; account_id: string | null; tag_names: string[] }) => Promise<void>
}) {
  const [categoryId, setCategoryId] = useState(row.category_id ?? '')
  const [accountId, setAccountId] = useState(row.account_id ?? '')
  const [tagText, setTagText] = useState(row.tag_names.join(', '))

  useEffect(() => {
    setCategoryId(row.category_id ?? '')
    setAccountId(row.account_id ?? '')
    setTagText(row.tag_names.join(', '))
  }, [row.account_id, row.category_id, row.tag_names])

  return (
    <div className="statement-row-correction">
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        disabled={busy}
        aria-label={`Category for ${row.description}`}
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        disabled={busy}
        aria-label={`Account for ${row.description}`}
      >
        <option value="">No account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
        ))}
      </select>
      <input
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
        disabled={busy}
        placeholder="tags"
        aria-label={`Tags for ${row.description}`}
      />
      <button
        type="button"
        onClick={() => void onSave({ category_id: categoryId || null, account_id: accountId || null, tag_names: parseTagNames(tagText) })}
        disabled={busy}
      >
        Save
      </button>
    </div>
  )
}
