'use client'

import { useCallback, useEffect, useState } from 'react'
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
  getAccessUsers,
  getAccounts,
  getAlerts,
  getAuditLog,
  getBudgets,
  getCaptures,
  getCaptureSummary,
  getCategories,
  getLedgers,
  getMe,
  getReconciliation,
  getRestoreDrills,
  getRuleSuggestions,
  getSettlement,
  getSmartRules,
  getStatements,
  getSubscriptions,
  getTags,
  grantAccessUser,
  renameCategory,
  revokeAccessUser,
  setBudget,
  setSelectedLedgerId,
  setSubscriptionPreference,
  replayCapture,
  ignoreCapture,
  undoAuditEvent,
  updateAccount,
  updateAccessUserRole,
  updateSmartRule,
  type Account,
  type AccessUser,
  type AuditEvent,
  type BudgetVariance,
  type CaptureCountSummary,
  type CaptureEvent,
  type CaptureFailureSummary,
  type Category,
  type HouseholdSettlement,
  type Ledger,
  type Me,
  type ReconciliationResult,
  type RestoreDrill,
  type RuleSuggestion,
  type SmartRule,
  type StatementImport,
  type SubscriptionCandidate,
  type Tag,
  type UserAlert,
} from '../../../lib/api'
import { currentMonthValue, splitMonth } from './components/helpers'
import type { RuleDraft } from './components/SmartRulesPanel'
import AccountsPanel from './components/AccountsPanel'
import AlertsPanel from './components/AlertsPanel'
import AuditTrailPanel from './components/AuditTrailPanel'
import BudgetsPanel from './components/BudgetsPanel'
import CaptureWorkbenchPanel from './components/CaptureWorkbenchPanel'
import CategoriesPanel from './components/CategoriesPanel'
import LedgerAccessPanel from './components/LedgerAccessPanel'
import ObservabilityPanel from './components/ObservabilityPanel'
import ReconciliationPanel from './components/ReconciliationPanel'
import RestoreDrillsPanel from './components/RestoreDrillsPanel'
import SettlementPanel from './components/SettlementPanel'
import SmartRulesPanel from './components/SmartRulesPanel'
import StatementImportsPanel from './components/StatementImportsPanel'
import SubscriptionsPanel from './components/SubscriptionsPanel'
import TagsPanel from './components/TagsPanel'

export default function ManagePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [budgets, setBudgets] = useState<BudgetVariance[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [alerts, setAlerts] = useState<UserAlert[]>([])
  const [captures, setCaptures] = useState<CaptureEvent[]>([])
  const [captureFailures, setCaptureFailures] = useState<CaptureFailureSummary[]>([])
  const [captureStatusCounts, setCaptureStatusCounts] = useState<CaptureCountSummary[]>([])
  const [captureSourceCounts, setCaptureSourceCounts] = useState<CaptureCountSummary[]>([])
  const [rules, setRules] = useState<SmartRule[]>([])
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([])
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null)
  const [settlement, setSettlement] = useState<HouseholdSettlement | null>(null)
  const [restoreDrills, setRestoreDrills] = useState<RestoreDrill[]>([])
  const [statements, setStatements] = useState<StatementImport[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionCandidate[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditDetail, setAuditDetail] = useState<AuditEvent | null>(null)
  const [auditLimit, setAuditLimit] = useState(30)
  const [auditAction, setAuditAction] = useState('')
  const [auditEntityType, setAuditEntityType] = useState('')
  const [month, setMonth] = useState(currentMonthValue)
  const [captureStatus, setCaptureStatus] = useState<'pending' | 'processed' | 'failed' | 'ignored'>('failed')
  const [captureSource, setCaptureSource] = useState('')
  const [captureFailureKind, setCaptureFailureKind] = useState('')
  const [captureSearch, setCaptureSearch] = useState('')
  const [reconcileAccount, setReconcileAccount] = useState('')
  const [defaultCategoryId, setDefaultCategoryId] = useState('')
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null)
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
      getCaptures({
        status: captureStatus,
        source: captureSource || undefined,
        failureKind: captureFailureKind || undefined,
        q: captureSearch.trim() || undefined,
        limit: 50,
      }),
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
      getLedgers(),
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
      ledgerRes,
      accessRes,
      restoreDrillRes,
    ] = await Promise.all([
      ...dataPromises,
      meRes.can_manage ? getAccessUsers() : Promise.resolve({ users: [] }),
      meRes.can_manage ? getRestoreDrills() : Promise.resolve({ drills: [] }),
    ])
    setMe(meRes)
    setLedgers(ledgerRes.ledgers)
    setAccessUsers(accessRes.users)
    setCategories(cats)
    setAccounts(accountRes.accounts)
    setBudgets(budgetRes.budgets)
    setTags(tagRes.tags)
    setAlerts(alertRes.alerts)
    setCaptures(captureRes.captures)
    setCaptureFailures(captureSummaryRes.failures ?? [])
    setCaptureStatusCounts(captureSummaryRes.statuses ?? [])
    setCaptureSourceCounts(captureSummaryRes.sources ?? [])
    setRules(ruleRes.rules)
    setSuggestions(suggestionRes.suggestions)
    setStatements(statementRes.statements)
    setSubscriptions(subscriptionRes.subscriptions)
    setAuditEvents(auditRes.events)
    setReconciliation(reconciliationRes)
    setSettlement(settlementRes.settlement)
    setRestoreDrills(restoreDrillRes.drills)
    setDefaultCategoryId((current) => current || cats[0]?.id || '')
  }, [auditAction, auditEntityType, auditLimit, captureFailureKind, captureSearch, captureSource, captureStatus, month, reconcileAccount])

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message))
  }, [refresh])

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  const latestAuditEvent = auditEvents[0] ?? null

  function switchLedger(ledgerId: number) {
    setSelectedLedgerId(ledgerId)
    window.location.reload()
  }

  async function undoAudit(auditId: string) {
    const event = await undoAuditEvent(auditId)
    setAuditDetail(event)
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Manage</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Budget month" />
      </div>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="grid-2">
        <ObservabilityPanel
          me={me}
          alerts={alerts}
          captureStatusCounts={captureStatusCounts}
          captureFailures={captureFailures}
          restoreDrills={restoreDrills}
          latestAuditEvent={latestAuditEvent}
          onShowAuditDetail={setAuditDetail}
        />

        <LedgerAccessPanel
          me={me}
          ledgers={ledgers}
          accessUsers={accessUsers}
          busy={busy}
          onSwitchLedger={switchLedger}
          onAddUser={(data) => run(() => grantAccessUser(data).then(() => undefined))}
          onChangeUser={(user, data) => run(() => updateAccessUserRole(user.telegram_user_id, data).then(() => undefined))}
          onRevokeUser={(user) => run(() => revokeAccessUser(user.telegram_user_id))}
          onReactivateUser={(user) => run(() => grantAccessUser({
            telegram_user_id: user.telegram_user_id,
            first_name: user.first_name,
            username: user.username,
            role: user.role,
            can_view: true,
            can_add: user.can_add,
          }).then(() => undefined))}
        />

        <AlertsPanel
          alerts={alerts}
          busy={busy}
          onDismiss={(alertId) => run(() => dismissAlert(alertId))}
        />

        <AccountsPanel
          accounts={accounts}
          busy={busy}
          onAdd={(data) => run(() => createAccount(data).then(() => undefined))}
          onSetDefault={(accountId) => run(() => updateAccount(accountId, { is_default: true }).then(() => undefined))}
          onArchive={(accountId) => run(() => archiveAccount(accountId))}
        />

        <ReconciliationPanel
          month={month}
          accounts={accounts}
          reconcileAccount={reconcileAccount}
          reconciliation={reconciliation}
          busy={busy}
          onSetMonth={setMonth}
          onSetReconcileAccount={setReconcileAccount}
          onRefresh={() => run(async () => undefined)}
        />

        <SettlementPanel
          me={me}
          settlement={settlement}
        />

        <SmartRulesPanel
          rules={rules}
          suggestions={suggestions}
          categories={categories}
          accounts={accounts}
          busy={busy}
          ruleDraft={ruleDraft}
          onDraftConsumed={() => setRuleDraft(null)}
          onAdd={(data) => run(() => createSmartRule(data).then(() => undefined))}
          onToggleEnabled={(ruleId, enabled) => run(() => updateSmartRule(ruleId, { enabled }).then(() => undefined))}
          onDelete={(ruleId) => run(() => deleteSmartRule(ruleId))}
          onAcceptSuggestion={(suggestionId) => run(() => acceptRuleSuggestion(suggestionId).then(() => undefined))}
          onDismissSuggestion={(suggestionId) => run(() => dismissRuleSuggestion(suggestionId).then(() => undefined))}
        />

        <CaptureWorkbenchPanel
          captures={captures}
          captureStatusCounts={captureStatusCounts}
          captureSourceCounts={captureSourceCounts}
          captureFailures={captureFailures}
          captureStatus={captureStatus}
          captureSource={captureSource}
          captureFailureKind={captureFailureKind}
          captureSearch={captureSearch}
          busy={busy}
          onSetCaptureStatus={setCaptureStatus}
          onSetCaptureSource={setCaptureSource}
          onSetCaptureFailureKind={setCaptureFailureKind}
          onSetCaptureSearch={setCaptureSearch}
          onReplay={(captureId) => run(() => replayCapture(captureId).then(() => undefined))}
          onIgnore={(captureId) => run(() => ignoreCapture(captureId))}
          onMakeRule={(draft) => {
            setRuleDraft(draft)
          }}
        />

        <CategoriesPanel
          categories={categories}
          busy={busy}
          onAdd={(name) => run(() => createCategory(name).then(() => undefined))}
          onRename={(categoryId, name) => run(() => renameCategory(categoryId, name).then(() => undefined))}
          onDelete={(categoryId) => run(() => deleteCategory(categoryId))}
        />

        <BudgetsPanel
          categories={categories}
          budgets={budgets}
          busy={busy}
          defaultCategoryId={defaultCategoryId}
          onSetBudget={(categoryId, cents) => run(() => setBudget(categoryId, cents))}
          onClearBudget={(categoryId) => run(() => clearBudget(categoryId))}
          onError={(msg) => setError(msg)}
        />

        <TagsPanel tags={tags} />

        <SubscriptionsPanel
          subscriptions={subscriptions}
          busy={busy}
          onConfirm={(s) => run(() => setSubscriptionPreference(s.merchant_key, s.name, 'confirmed'))}
          onIgnore={(s) => run(() => setSubscriptionPreference(s.merchant_key, s.name, 'ignored'))}
          onInactive={(s) => run(() => setSubscriptionPreference(s.merchant_key, s.name, 'inactive'))}
          onClearPreference={(s) => run(() => clearSubscriptionPreference(s.merchant_key))}
        />

        <StatementImportsPanel
          statements={statements}
          categories={categories}
          accounts={accounts}
          busy={busy}
          onRun={run}
          onError={(msg) => setError(msg)}
        />

        <RestoreDrillsPanel
          me={me}
          restoreDrills={restoreDrills}
        />

        <AuditTrailPanel
          auditEvents={auditEvents}
          auditDetail={auditDetail}
          auditAction={auditAction}
          auditEntityType={auditEntityType}
          auditLimit={auditLimit}
          busy={busy}
          onSetAuditAction={setAuditAction}
          onSetAuditEntityType={setAuditEntityType}
          onSetAuditLimit={setAuditLimit}
          onSetAuditDetail={setAuditDetail}
          onUndo={(auditId) => run(() => undoAudit(auditId))}
        />
      </div>
    </div>
  )
}
