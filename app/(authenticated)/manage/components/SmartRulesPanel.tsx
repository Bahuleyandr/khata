'use client'

import { useEffect, useState } from 'react'
import type { Account, Category, RuleSuggestion, SmartRule } from '../../../../lib/api'
import { parseTagNames } from './helpers'

export type RuleDraft = {
  name: string
  pattern: string
  scope: 'merchant' | 'description' | 'raw_text' | 'any'
  matchType: 'contains' | 'equals' | 'regex'
  reviewStatus: string
}

export default function SmartRulesPanel({
  rules,
  suggestions,
  categories,
  accounts,
  busy,
  ruleDraft,
  onDraftConsumed,
  onAdd,
  onToggleEnabled,
  onDelete,
  onAcceptSuggestion,
  onDismissSuggestion,
}: {
  rules: SmartRule[]
  suggestions: RuleSuggestion[]
  categories: Category[]
  accounts: Account[]
  busy: boolean
  ruleDraft: RuleDraft | null
  onDraftConsumed: () => void
  onAdd: (data: {
    name: string
    pattern: string
    match_scope: 'merchant' | 'description' | 'raw_text' | 'any'
    match_type: 'contains' | 'equals' | 'regex'
    category_id: string | null
    account_id: string | null
    tag_names: string[]
    review_status: 'needs_review' | 'reviewed' | 'ignored' | null
  }) => Promise<boolean>
  onToggleEnabled: (ruleId: string, enabled: boolean) => Promise<boolean>
  onDelete: (ruleId: string) => Promise<boolean>
  onAcceptSuggestion: (suggestionId: string) => Promise<boolean>
  onDismissSuggestion: (suggestionId: string) => Promise<boolean>
}) {
  const [newRuleName, setNewRuleName] = useState('')
  const [newRulePattern, setNewRulePattern] = useState('')
  const [newRuleCategory, setNewRuleCategory] = useState('')
  const [newRuleAccount, setNewRuleAccount] = useState('')
  const [newRuleTags, setNewRuleTags] = useState('')
  const [newRuleScope, setNewRuleScope] = useState<'merchant' | 'description' | 'raw_text' | 'any'>('any')
  const [newRuleMatchType, setNewRuleMatchType] = useState<'contains' | 'equals' | 'regex'>('contains')
  const [newRuleReviewStatus, setNewRuleReviewStatus] = useState('')

  // Apply rule draft when coordinator signals it (cross-panel Make Rule flow)
  useEffect(() => {
    if (!ruleDraft) return
    setNewRuleName(ruleDraft.name)
    setNewRulePattern(ruleDraft.pattern)
    setNewRuleScope(ruleDraft.scope)
    setNewRuleMatchType(ruleDraft.matchType)
    setNewRuleReviewStatus(ruleDraft.reviewStatus)
    onDraftConsumed()
  }, [ruleDraft, onDraftConsumed])

  async function createNewRule() {
    if (!newRuleName.trim() || !newRulePattern.trim()) return
    const ok = await onAdd({
      name: newRuleName,
      pattern: newRulePattern,
      match_scope: newRuleScope,
      match_type: newRuleMatchType,
      category_id: newRuleCategory || null,
      account_id: newRuleAccount || null,
      tag_names: parseTagNames(newRuleTags),
      review_status: newRuleReviewStatus ? (newRuleReviewStatus as 'needs_review' | 'reviewed' | 'ignored') : null,
    })
    if (ok) {
      setNewRuleName('')
      setNewRulePattern('')
      setNewRuleTags('')
    }
  }

  return (
    <>
      <section className="card workspace-card wide-card" id="smart-rules">
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
          <button type="button" onClick={() => void createNewRule()} disabled={busy || !newRuleName.trim() || !newRulePattern.trim()}>Add</button>
        </div>
        <div className="statement-list">
          {rules.length === 0 ? <p>No rules yet.</p> : rules.map((rule) => (
            <div key={rule.id} className="statement-row">
              <div>
                <strong>{rule.name} <span className="badge badge-muted">{rule.match_scope}:{rule.match_type}</span></strong>
                <span>{rule.pattern} · {rule.category ?? 'category unchanged'} · {rule.account ?? 'account unchanged'} · {rule.tag_names.join(', ') || 'no tags'}</span>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => void onToggleEnabled(rule.id, !rule.enabled)} disabled={busy}>
                  {rule.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="danger" onClick={() => void onDelete(rule.id)} disabled={busy}>
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
                <button type="button" onClick={() => void onAcceptSuggestion(suggestion.id)} disabled={busy}>
                  Accept
                </button>
                <button type="button" onClick={() => void onDismissSuggestion(suggestion.id)} disabled={busy}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
