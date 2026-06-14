'use client'

import { formatDate, type AuditEvent, type CaptureCountSummary, type CaptureFailureSummary, type Me, type RestoreDrill, type UserAlert } from '../../../../lib/api'
import { auditLabel, captureCount, captureLabel, formatAuditDate } from './helpers'

export default function ObservabilityPanel({
  me,
  alerts,
  captureStatusCounts,
  captureFailures,
  restoreDrills,
  latestAuditEvent,
  onShowAuditDetail,
}: {
  me: Me | null
  alerts: UserAlert[]
  captureStatusCounts: CaptureCountSummary[]
  captureFailures: CaptureFailureSummary[]
  restoreDrills: RestoreDrill[]
  latestAuditEvent: AuditEvent | null
  onShowAuditDetail: (event: AuditEvent) => void
}) {
  const failedCaptureCount = captureCount(captureStatusCounts, 'failed')
  const pendingCaptureCount = captureCount(captureStatusCounts, 'pending')
  const processedCaptureCount = captureCount(captureStatusCounts, 'processed')
  const latestRestoreDrill = restoreDrills[0] ?? null
  const criticalAlertCount = alerts.filter((alert) => alert.severity === 'critical').length
  const opsAttentionCount =
    failedCaptureCount +
    pendingCaptureCount +
    alerts.length +
    (latestRestoreDrill && latestRestoreDrill.status !== 'passed' ? 1 : 0)
  const topCaptureFailures = captureFailures.slice(0, 3)

  return (
    <section className="card workspace-card wide-card ops-panel">
      <div className="ops-heading">
        <div>
          <h3>Observability</h3>
          <p className="muted-copy">{me?.selected_ledger_name ?? 'Current ledger'} · {formatDate(new Date().toISOString())}</p>
        </div>
        <span className={`badge ${opsAttentionCount > 0 ? 'badge-warning' : 'badge-confirmed'}`}>
          {opsAttentionCount > 0 ? `${opsAttentionCount} signals` : 'clear'}
        </span>
      </div>
      <div className="ops-grid">
        <a href="#alerts" className="ops-card">
          <span>Open alerts</span>
          <strong>{alerts.length}</strong>
          <small>{criticalAlertCount} critical</small>
        </a>
        <a href="#capture-workbench" className="ops-card">
          <span>Failed captures</span>
          <strong>{failedCaptureCount}</strong>
          <small>{pendingCaptureCount} pending · {processedCaptureCount} processed</small>
        </a>
        <div className="ops-card">
          <span>Restore drill</span>
          <strong>{latestRestoreDrill?.status ?? 'none'}</strong>
          <small>{latestRestoreDrill ? formatAuditDate(latestRestoreDrill.checked_at) : 'No drill recorded'}</small>
        </div>
        <button
          type="button"
          className="ops-card"
          onClick={() => latestAuditEvent ? onShowAuditDetail(latestAuditEvent) : undefined}
        >
          <span>Last audit</span>
          <strong>{latestAuditEvent ? auditLabel(latestAuditEvent) : 'none'}</strong>
          <small>{latestAuditEvent ? formatAuditDate(latestAuditEvent.created_at) : 'No events'}</small>
        </button>
      </div>
      <div className="ops-rail">
        <div>
          <strong>Capture failure mix</strong>
          {topCaptureFailures.length === 0 ? (
            <span>No capture failures in the current window.</span>
          ) : (
            topCaptureFailures.map((failure) => (
              <span key={failure.failure_kind}>
                {captureLabel(failure.failure_kind)} · {failure.count}
              </span>
            ))
          )}
        </div>
        <div>
          <strong>Latest restore detail</strong>
          <span>
            {latestRestoreDrill
              ? `${latestRestoreDrill.backup_key ?? 'No backup key'} · ${latestRestoreDrill.duration_ms ? `${Math.round(latestRestoreDrill.duration_ms / 1000)}s` : 'duration unknown'}`
              : 'No restore drill recorded'}
          </span>
        </div>
      </div>
    </section>
  )
}
