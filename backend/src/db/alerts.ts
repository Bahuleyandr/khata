import { sql } from "./index.js";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "dismissed" | "resolved";

export interface UserAlertRow {
  id: string;
  user_id: number;
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string | null;
  dedupe_key: string;
  status: AlertStatus;
  created_at: Date;
  updated_at: Date;
  dismissed_at: Date | null;
}

interface AlertCandidate {
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string | null;
  dedupeKey: string;
}

async function upsertAlert(userId: number, alert: AlertCandidate): Promise<void> {
  await sql`
    INSERT INTO user_alerts (
      user_id,
      kind,
      severity,
      title,
      detail,
      href,
      dedupe_key,
      status
    )
    VALUES (
      ${userId},
      ${alert.kind},
      ${alert.severity},
      ${alert.title},
      ${alert.detail},
      ${alert.href},
      ${alert.dedupeKey},
      'open'
    )
    ON CONFLICT (user_id, dedupe_key) DO UPDATE
    SET kind = EXCLUDED.kind,
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        href = EXCLUDED.href,
        status = CASE
          WHEN user_alerts.status = 'dismissed' THEN user_alerts.status
          ELSE 'open'
        END,
        updated_at = NOW()
  `;
}

export async function refreshUserAlerts(userId: number): Promise<void> {
  const [captureCounts] = await sql<Array<{
    failed_count: string;
    pending_count: string;
  }>>`
    SELECT COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count
    FROM capture_events
    WHERE user_id = ${userId}
      AND created_at >= NOW() - INTERVAL '45 days'
  `;

  const [statementCounts] = await sql<Array<{
    failed_count: string;
    pending_rows: string;
  }>>`
    SELECT COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'failed')::text AS failed_count,
           COUNT(r.id) FILTER (WHERE r.status = 'pending')::text AS pending_rows
    FROM statements s
    LEFT JOIN statement_import_rows r
      ON r.statement_id = s.id
     AND r.user_id = s.user_id
    WHERE s.user_id = ${userId}
      AND s.created_at >= NOW() - INTERVAL '90 days'
  `;

  const [budgetCounts] = await sql<Array<{ over_budget_count: string }>>`
    WITH current_month AS (
      SELECT to_char(NOW(), 'YYYY-MM') AS month_key,
             date_trunc('month', NOW())::date AS month_start,
             (date_trunc('month', NOW()) + INTERVAL '1 month')::date AS month_end
    ),
    spent AS (
      SELECT e.category_id,
             SUM(e.amount_cents) AS spent_cents
      FROM expenses e, current_month cm
      WHERE e.user_id = ${userId}
        AND e.category_id IS NOT NULL
        AND e.occurred_at >= cm.month_start
        AND e.occurred_at < cm.month_end
      GROUP BY e.category_id
    )
    SELECT COUNT(*)::text AS over_budget_count
    FROM category_budgets b
    JOIN current_month cm ON TRUE
    JOIN spent ON spent.category_id = b.category_id
    WHERE b.user_id = ${userId}
      AND spent.spent_cents > b.target_cents
  `;

  const [subscriptionCounts] = await sql<Array<{ overdue_count: string }>>`
    WITH prefs AS (
      SELECT merchant_key, merchant_name
      FROM subscription_preferences
      WHERE user_id = ${userId}
        AND status = 'confirmed'
    ),
    latest AS (
      SELECT lower(COALESCE(mc.name, e.merchant, e.description)) AS merchant_key,
             MAX(e.occurred_at)::date AS last_seen
      FROM expenses e
      LEFT JOIN merchants_canonical mc ON mc.id = e.merchant_canonical_id
      WHERE e.user_id = ${userId}
        AND e.occurred_at >= NOW() - INTERVAL '9 months'
      GROUP BY lower(COALESCE(mc.name, e.merchant, e.description))
    )
    SELECT COUNT(*)::text AS overdue_count
    FROM prefs
    LEFT JOIN latest ON latest.merchant_key = prefs.merchant_key
    WHERE latest.last_seen IS NULL
       OR latest.last_seen < (NOW() - INTERVAL '45 days')::date
  `;

  const alerts: AlertCandidate[] = [];
  const failedCaptures = Number(captureCounts?.failed_count ?? 0);
  const pendingCaptures = Number(captureCounts?.pending_count ?? 0);
  const pendingStatementRows = Number(statementCounts?.pending_rows ?? 0);
  const failedStatements = Number(statementCounts?.failed_count ?? 0);
  const overBudgets = Number(budgetCounts?.over_budget_count ?? 0);
  const overdueSubscriptions = Number(subscriptionCounts?.overdue_count ?? 0);

  if (failedCaptures > 0) {
    alerts.push({
      kind: "capture_failed",
      severity: failedCaptures >= 3 ? "critical" : "warning",
      title: `${failedCaptures} capture${failedCaptures === 1 ? "" : "s"} failed`,
      detail: "Review the raw capture inbox and replay or ignore the failed items.",
      href: "/manage#capture-inbox",
      dedupeKey: "capture_failed",
    });
  }
  if (pendingCaptures > 0) {
    alerts.push({
      kind: "capture_pending",
      severity: "info",
      title: `${pendingCaptures} raw capture${pendingCaptures === 1 ? "" : "s"} pending`,
      detail: "These messages/photos have not been resolved into transactions yet.",
      href: "/manage#capture-inbox",
      dedupeKey: "capture_pending",
    });
  }
  if (pendingStatementRows > 0 || failedStatements > 0) {
    alerts.push({
      kind: "statement_review",
      severity: failedStatements > 0 ? "warning" : "info",
      title: "Statement review needs attention",
      detail: `${pendingStatementRows} row${pendingStatementRows === 1 ? "" : "s"} pending, ${failedStatements} failed import${failedStatements === 1 ? "" : "s"}.`,
      href: "/manage#statements",
      dedupeKey: "statement_review",
    });
  }
  if (overBudgets > 0) {
    alerts.push({
      kind: "budget_overrun",
      severity: "warning",
      title: `${overBudgets} budget${overBudgets === 1 ? "" : "s"} over target`,
      detail: "Check this month before the close review.",
      href: "/dashboard",
      dedupeKey: "budget_overrun",
    });
  }
  if (overdueSubscriptions > 0) {
    alerts.push({
      kind: "subscription_overdue",
      severity: "warning",
      title: `${overdueSubscriptions} confirmed subscription${overdueSubscriptions === 1 ? "" : "s"} not seen recently`,
      detail: "Confirm whether these are cancelled, paused, or missing from capture.",
      href: "/manage#subscriptions",
      dedupeKey: "subscription_overdue",
    });
  }

  for (const alert of alerts) {
    await upsertAlert(userId, alert);
  }

  const activeDedupeKeys = alerts.map((alert) => alert.dedupeKey);
  await sql`
    UPDATE user_alerts
    SET status = 'resolved',
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND status = 'open'
      ${activeDedupeKeys.length > 0
        ? sql`AND dedupe_key <> ALL(${activeDedupeKeys}::text[])`
        : sql``}
  `;
}

export async function listUserAlerts(
  userId: number,
  options: { includeResolved?: boolean } = {},
): Promise<UserAlertRow[]> {
  await refreshUserAlerts(userId);
  return sql<UserAlertRow[]>`
    SELECT id,
           user_id::bigint::int AS user_id,
           kind,
           severity,
           title,
           detail,
           href,
           dedupe_key,
           status,
           created_at,
           updated_at,
           dismissed_at
    FROM user_alerts
    WHERE user_id = ${userId}
      ${options.includeResolved === true ? sql`` : sql`AND status = 'open'`}
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      created_at DESC
  `;
}

export async function dismissUserAlert(userId: number, alertId: string): Promise<UserAlertRow | null> {
  const [row] = await sql<UserAlertRow[]>`
    UPDATE user_alerts
    SET status = 'dismissed',
        dismissed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${alertId}
      AND user_id = ${userId}
      AND status = 'open'
    RETURNING id,
              user_id::bigint::int AS user_id,
              kind,
              severity,
              title,
              detail,
              href,
              dedupe_key,
              status,
              created_at,
              updated_at,
              dismissed_at
  `;
  return row ?? null;
}
