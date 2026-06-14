'use client'

import { useMemo } from 'react'
import type { AuditEvent } from '../../../../lib/api'
import { AUDIT_ACTION_OPTIONS, AUDIT_ENTITY_OPTIONS, auditDiff, auditLabel, canUndoAudit, formatAuditCell, formatAuditDate, formatAuditJson } from './helpers'

export default function AuditTrailPanel({
  auditEvents,
  auditDetail,
  auditAction,
  auditEntityType,
  auditLimit,
  busy,
  onSetAuditAction,
  onSetAuditEntityType,
  onSetAuditLimit,
  onSetAuditDetail,
  onUndo,
}: {
  auditEvents: AuditEvent[]
  auditDetail: AuditEvent | null
  auditAction: string
  auditEntityType: string
  auditLimit: number
  busy: boolean
  onSetAuditAction: (value: string) => void
  onSetAuditEntityType: (value: string) => void
  onSetAuditLimit: (value: number) => void
  onSetAuditDetail: (event: AuditEvent | null) => void
  onUndo: (auditId: string) => Promise<void>
}) {
  const auditActions = useMemo(
    () => Array.from(new Set([...AUDIT_ACTION_OPTIONS, ...auditEvents.map((event) => event.action)])).sort(),
    [auditEvents],
  )
  const auditEntityTypes = useMemo(
    () => Array.from(new Set([...AUDIT_ENTITY_OPTIONS, ...auditEvents.map((event) => event.entity_type)])).sort(),
    [auditEvents],
  )

  return (
    <section className="card workspace-card wide-card">
      <h3>Audit Trail</h3>
      <div className="audit-filter-bar">
        <select
          value={auditAction}
          onChange={(e) => onSetAuditAction(e.target.value)}
          aria-label="Audit action"
        >
          <option value="">All actions</option>
          {auditActions.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <select
          value={auditEntityType}
          onChange={(e) => onSetAuditEntityType(e.target.value)}
          aria-label="Audit entity type"
        >
          <option value="">All entities</option>
          {auditEntityTypes.map((entityType) => (
            <option key={entityType} value={entityType}>{entityType}</option>
          ))}
        </select>
        <select
          value={auditLimit}
          onChange={(e) => onSetAuditLimit(Number(e.target.value))}
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
            onClick={() => onSetAuditDetail(event)}
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
                  onClick={() => void onUndo(auditDetail.id)}
                  disabled={busy}
                >
                  Undo change
                </button>
              ) : null}
              <button type="button" onClick={() => onSetAuditDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
