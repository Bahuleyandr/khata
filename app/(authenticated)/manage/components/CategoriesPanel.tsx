'use client'

import { useEffect, useState } from 'react'
import type { Category } from '../../../../lib/api'

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

export default function CategoriesPanel({
  categories,
  busy,
  onAdd,
  onRename,
  onDelete,
}: {
  categories: Category[]
  busy: boolean
  onAdd: (name: string) => Promise<void>
  onRename: (categoryId: string, name: string) => Promise<void>
  onDelete: (categoryId: string) => Promise<void>
}) {
  const [newCategory, setNewCategory] = useState('')

  async function addCategory() {
    const name = newCategory.trim()
    if (!name) return
    await onAdd(name)
    setNewCategory('')
  }

  return (
    <section className="card workspace-card">
      <h3>Categories</h3>
      <div className="inline-form">
        <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category" />
        <button type="button" onClick={() => void addCategory()} disabled={busy}>Add</button>
      </div>
      <div className="stack-list">
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            busy={busy}
            onRename={(name) => onRename(category.id, name)}
            onDelete={() => onDelete(category.id)}
          />
        ))}
      </div>
    </section>
  )
}
