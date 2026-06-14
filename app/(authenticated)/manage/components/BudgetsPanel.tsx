'use client'

import { useState } from 'react'
import { formatCents, type BudgetVariance, type Category } from '../../../../lib/api'
import { rupeesToCents } from './helpers'

export default function BudgetsPanel({
  categories,
  budgets,
  busy,
  defaultCategoryId,
  onSetBudget,
  onClearBudget,
  onError,
}: {
  categories: Category[]
  budgets: BudgetVariance[]
  busy: boolean
  defaultCategoryId: string
  onSetBudget: (categoryId: string, cents: number) => Promise<boolean>
  onClearBudget: (categoryId: string) => Promise<boolean>
  onError: (msg: string) => void
}) {
  const [budgetCategory, setBudgetCategory] = useState(defaultCategoryId)
  const [budgetAmount, setBudgetAmount] = useState('')

  // Sync when defaultCategoryId changes (first load)
  // We use a local init pattern: only set to defaultCategoryId if we have no local value yet
  // The coordinator passes cats[0]?.id once categories load
  const effectiveBudgetCategory = budgetCategory || defaultCategoryId

  async function saveBudget() {
    const cents = rupeesToCents(budgetAmount)
    if (!effectiveBudgetCategory || !cents) {
      onError('Choose a category and enter a valid amount.')
      return
    }
    const ok = await onSetBudget(effectiveBudgetCategory, cents)
    if (ok) setBudgetAmount('')
  }

  return (
    <section className="card workspace-card">
      <h3>Budgets</h3>
      <div className="inline-form">
        <select value={effectiveBudgetCategory} onChange={(e) => setBudgetCategory(e.target.value)}>
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
        <button type="button" onClick={() => void saveBudget()} disabled={busy}>Set</button>
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
                <button type="button" onClick={() => void onClearBudget(budget.category_id)} disabled={busy}>
                  Clear
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
