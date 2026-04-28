'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clearBudget,
  createCategory,
  deleteCategory,
  formatCents,
  getBudgets,
  getCategories,
  getStatements,
  getTags,
  renameCategory,
  retryStatement,
  setBudget,
  type BudgetVariance,
  type Category,
  type StatementImport,
  type Tag,
} from '../../../lib/api'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function rupeesToCents(value: string) {
  const cleaned = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [rupees, paise = ''] = cleaned.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

export default function ManagePage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<BudgetVariance[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [statements, setStatements] = useState<StatementImport[]>([])
  const [month, setMonth] = useState(currentMonthValue)
  const [newCategory, setNewCategory] = useState('')
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    const [cats, budgetRes, tagRes, statementRes] = await Promise.all([
      getCategories(),
      getBudgets(month),
      getTags(),
      getStatements(),
    ])
    setCategories(cats)
    setBudgets(budgetRes.budgets)
    setTags(tagRes.tags)
    setStatements(statementRes.statements)
    setBudgetCategory((current) => current || cats[0]?.id || '')
  }, [month])

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

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Manage</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Budget month" />
      </div>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="grid-2">
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
          <h3>Statement Imports</h3>
          <div className="statement-list">
            {statements.length === 0 ? <p>No statement imports yet.</p> : statements.map((statement) => (
              <div key={statement.id} className="statement-row">
                <div>
                  <strong>{statement.status}</strong>
                  <span>
                    {statement.parsed_count} parsed · {statement.imported_count} imported · {statement.duplicate_count} duplicates
                  </span>
                  {statement.error_reason ? <small>{statement.error_reason}</small> : null}
                </div>
                <button
                  type="button"
                  onClick={() => void run(() => retryStatement(statement.id))}
                  disabled={busy || !['failed', 'parsed'].includes(statement.status)}
                >
                  Retry
                </button>
              </div>
            ))}
          </div>
        </section>
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
