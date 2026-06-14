'use client'

import type { Tag } from '../../../../lib/api'

export default function TagsPanel({ tags }: { tags: Tag[] }) {
  return (
    <section className="card workspace-card">
      <h3>Tags</h3>
      <div className="tag-cloud">
        {tags.length === 0 ? <span>No tags yet.</span> : tags.map((tag) => (
          <span key={tag.id}>#{tag.name} · {tag.count}</span>
        ))}
      </div>
    </section>
  )
}
