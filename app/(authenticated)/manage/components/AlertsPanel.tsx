'use client'

import type { UserAlert } from '../../../../lib/api'

export default function AlertsPanel({
  alerts,
  busy,
  onDismiss,
}: {
  alerts: UserAlert[]
  busy: boolean
  onDismiss: (alertId: string) => Promise<void>
}) {
  return (
    <section className="card workspace-card" id="alerts">
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
              <button type="button" onClick={() => void onDismiss(alert.id)} disabled={busy}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
