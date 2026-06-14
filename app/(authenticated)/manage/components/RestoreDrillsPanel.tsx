'use client'

import type { Me, RestoreDrill } from '../../../../lib/api'
import { formatAuditDate } from './helpers'

export default function RestoreDrillsPanel({
  me,
  restoreDrills,
}: {
  me: Me | null
  restoreDrills: RestoreDrill[]
}) {
  return (
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
  )
}
