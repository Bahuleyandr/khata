import { sql } from "./index.js";

export type SubscriptionStatus = "active" | "trial" | "paused" | "cancelled";
export type BillingCycle = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly" | "custom";

export interface SubscriptionRecordInput {
  name: string;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  amount_cents: number;
  currency: string;
  category_id?: string | null;
  account_id?: string | null;
  payment_method?: string | null;
  started_at?: string | null;
  next_due_at?: string | null;
  interval_days?: number | null;
  reminder_days?: number[];
  notes?: string | null;
  logo_url?: string | null;
  merchant_key?: string | null;
  source?: "manual" | "detected";
}

interface SanitizedSubscriptionRecordInput extends SubscriptionRecordInput {
  name: string;
  currency: string;
  merchant_key: string | null;
  amount_cents: number;
  interval_days: number | null;
  reminder_days: number[];
  source: "manual" | "detected";
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  merchant_key: string | null;
  name: string;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  interval_days: number | null;
  amount_cents: string;
  currency: string;
  category_id: string | null;
  category: string | null;
  account_id: string | null;
  account: string | null;
  payment_method: string | null;
  started_at: string | null;
  next_due_at: string | null;
  days_until_next: number | null;
  monthly_estimate_cents: string;
  yearly_estimate_cents: string;
  reminder_days: number[];
  notes: string | null;
  logo_url: string | null;
  source: "manual" | "detected";
  created_at: string;
  updated_at: string;
}

export interface SubscriptionSummary {
  active_count: number;
  trial_count: number;
  paused_count: number;
  cancelled_count: number;
  due_soon_count: number;
  overdue_count: number;
  monthly_total_cents: string;
  yearly_total_cents: string;
}

type SubscriptionRow = Omit<SubscriptionRecord, "monthly_estimate_cents" | "yearly_estimate_cents">;

export function normalizeSubscriptionMerchantKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function monthlyEstimateCents(
  amountCents: number,
  cycle: BillingCycle,
  intervalDays?: number | null,
): number {
  if (cycle === "weekly") return Math.round(amountCents * 4.33);
  if (cycle === "fortnightly") return Math.round(amountCents * 2.17);
  if (cycle === "quarterly") return Math.round(amountCents / 3);
  if (cycle === "yearly") return Math.round(amountCents / 12);
  if (cycle === "custom" && intervalDays && intervalDays > 0) {
    return Math.round(amountCents * (30.4375 / intervalDays));
  }
  return amountCents;
}

function sanitizeInput(input: SubscriptionRecordInput): SanitizedSubscriptionRecordInput {
  const name = input.name.trim().replace(/\s+/g, " ");
  const merchantKey = input.merchant_key?.trim()
    ? normalizeSubscriptionMerchantKey(input.merchant_key)
    : normalizeSubscriptionMerchantKey(name);
  return {
    ...input,
    name,
    currency: input.currency.trim().toUpperCase().slice(0, 3) || "INR",
    merchant_key: merchantKey || null,
    amount_cents: Math.max(0, Math.round(input.amount_cents)),
    interval_days: input.billing_cycle === "custom" ? input.interval_days ?? null : null,
    reminder_days: (input.reminder_days?.length ? input.reminder_days : [3])
      .map((day) => Math.max(0, Math.round(day)))
      .filter((day, index, days) => days.indexOf(day) === index)
      .slice(0, 5),
    source: input.source ?? "manual",
  };
}

function toRecord(row: SubscriptionRow): SubscriptionRecord {
  const amount = Number(row.amount_cents);
  const monthly = monthlyEstimateCents(amount, row.billing_cycle, row.interval_days);
  return {
    ...row,
    monthly_estimate_cents: String(monthly),
    yearly_estimate_cents: String(monthly * 12),
  };
}

export function summarizeSubscriptionRecords(records: SubscriptionRecord[]): SubscriptionSummary {
  const activeRecords = records.filter((record) => record.status === "active" || record.status === "trial");
  const monthlyTotal = activeRecords.reduce((sum, record) => sum + Number(record.monthly_estimate_cents), 0);
  return {
    active_count: records.filter((record) => record.status === "active").length,
    trial_count: records.filter((record) => record.status === "trial").length,
    paused_count: records.filter((record) => record.status === "paused").length,
    cancelled_count: records.filter((record) => record.status === "cancelled").length,
    due_soon_count: activeRecords.filter((record) =>
      record.days_until_next !== null && record.days_until_next >= 0 && record.days_until_next <= 7,
    ).length,
    overdue_count: activeRecords.filter((record) =>
      record.days_until_next !== null && record.days_until_next < 0,
    ).length,
    monthly_total_cents: String(monthlyTotal),
    yearly_total_cents: String(monthlyTotal * 12),
  };
}

export async function listSubscriptionRecords(userId: number): Promise<SubscriptionRecord[]> {
  const rows = await sql<SubscriptionRow[]>`
    SELECT
      s.id,
      s.user_id::text AS user_id,
      s.merchant_key,
      s.name,
      s.status,
      s.billing_cycle,
      s.interval_days,
      s.amount_cents::text AS amount_cents,
      s.currency,
      s.category_id,
      c.name AS category,
      s.account_id,
      a.name AS account,
      s.payment_method,
      s.started_at::date::text AS started_at,
      s.next_due_at::date::text AS next_due_at,
      CASE WHEN s.next_due_at IS NULL THEN NULL ELSE (s.next_due_at - CURRENT_DATE)::int END AS days_until_next,
      s.reminder_days,
      s.notes,
      s.logo_url,
      s.source,
      s.created_at::text AS created_at,
      s.updated_at::text AS updated_at
    FROM subscriptions s
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN accounts a ON a.id = s.account_id
    WHERE s.user_id = ${userId}
    ORDER BY
      CASE s.status WHEN 'active' THEN 0 WHEN 'trial' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
      s.next_due_at NULLS LAST,
      lower(s.name)
  `;
  return rows.map(toRecord);
}

export async function createSubscriptionRecord(
  userId: number,
  input: SubscriptionRecordInput,
): Promise<SubscriptionRecord> {
  const data = sanitizeInput(input);
  const [row] = await sql<SubscriptionRow[]>`
    INSERT INTO subscriptions (
      user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents, currency, category_id, account_id, payment_method,
      started_at, next_due_at, reminder_days, notes, logo_url, source
    )
    VALUES (
      ${userId}, ${data.merchant_key}, ${data.name}, ${data.status}, ${data.billing_cycle}, ${data.interval_days ?? null},
      ${data.amount_cents}, ${data.currency}, ${data.category_id ?? null}, ${data.account_id ?? null}, ${data.payment_method ?? null},
      ${data.started_at ?? null}, ${data.next_due_at ?? null}, ${data.reminder_days}, ${data.notes ?? null}, ${data.logo_url ?? null},
      ${data.source}
    )
    RETURNING
      id, user_id::text AS user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents::text AS amount_cents, currency, category_id, NULL::text AS category,
      account_id, NULL::text AS account, payment_method, started_at::date::text AS started_at,
      next_due_at::date::text AS next_due_at,
      CASE WHEN next_due_at IS NULL THEN NULL ELSE (next_due_at - CURRENT_DATE)::int END AS days_until_next,
      reminder_days, notes, logo_url, source, created_at::text AS created_at, updated_at::text AS updated_at
  `;
  return toRecord(row!);
}

export async function updateSubscriptionRecord(
  userId: number,
  id: string,
  input: SubscriptionRecordInput,
): Promise<SubscriptionRecord | null> {
  const data = sanitizeInput(input);
  const [row] = await sql<SubscriptionRow[]>`
    UPDATE subscriptions
    SET
      merchant_key = ${data.merchant_key},
      name = ${data.name},
      status = ${data.status},
      billing_cycle = ${data.billing_cycle},
      interval_days = ${data.interval_days ?? null},
      amount_cents = ${data.amount_cents},
      currency = ${data.currency},
      category_id = ${data.category_id ?? null},
      account_id = ${data.account_id ?? null},
      payment_method = ${data.payment_method ?? null},
      started_at = ${data.started_at ?? null},
      next_due_at = ${data.next_due_at ?? null},
      reminder_days = ${data.reminder_days},
      notes = ${data.notes ?? null},
      logo_url = ${data.logo_url ?? null},
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND id = ${id}
    RETURNING
      id, user_id::text AS user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents::text AS amount_cents, currency, category_id, NULL::text AS category,
      account_id, NULL::text AS account, payment_method, started_at::date::text AS started_at,
      next_due_at::date::text AS next_due_at,
      CASE WHEN next_due_at IS NULL THEN NULL ELSE (next_due_at - CURRENT_DATE)::int END AS days_until_next,
      reminder_days, notes, logo_url, source, created_at::text AS created_at, updated_at::text AS updated_at
  `;
  return row ? toRecord(row) : null;
}

export async function deleteSubscriptionRecord(userId: number, id: string): Promise<SubscriptionRecord | null> {
  const [row] = await sql<SubscriptionRow[]>`
    DELETE FROM subscriptions
    WHERE user_id = ${userId}
      AND id = ${id}
    RETURNING
      id, user_id::text AS user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents::text AS amount_cents, currency, category_id, NULL::text AS category,
      account_id, NULL::text AS account, payment_method, started_at::date::text AS started_at,
      next_due_at::date::text AS next_due_at,
      CASE WHEN next_due_at IS NULL THEN NULL ELSE (next_due_at - CURRENT_DATE)::int END AS days_until_next,
      reminder_days, notes, logo_url, source, created_at::text AS created_at, updated_at::text AS updated_at
  `;
  return row ? toRecord(row) : null;
}

export async function upsertDetectedSubscriptionRecord(
  userId: number,
  input: SubscriptionRecordInput & { merchant_key: string },
): Promise<SubscriptionRecord> {
  const data = sanitizeInput({ ...input, source: "detected" });
  const [row] = await sql<SubscriptionRow[]>`
    INSERT INTO subscriptions (
      user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents, currency, category_id, account_id, payment_method,
      started_at, next_due_at, reminder_days, notes, logo_url, source
    )
    VALUES (
      ${userId}, ${data.merchant_key}, ${data.name}, ${data.status}, ${data.billing_cycle}, ${data.interval_days ?? null},
      ${data.amount_cents}, ${data.currency}, ${data.category_id ?? null}, ${data.account_id ?? null}, ${data.payment_method ?? null},
      ${data.started_at ?? null}, ${data.next_due_at ?? null}, ${data.reminder_days}, ${data.notes ?? null}, ${data.logo_url ?? null},
      'detected'
    )
    ON CONFLICT (user_id, merchant_key) WHERE merchant_key IS NOT NULL
    DO UPDATE SET
      name = EXCLUDED.name,
      status = CASE WHEN subscriptions.status = 'cancelled' THEN 'active' ELSE subscriptions.status END,
      billing_cycle = EXCLUDED.billing_cycle,
      interval_days = EXCLUDED.interval_days,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      category_id = COALESCE(EXCLUDED.category_id, subscriptions.category_id),
      account_id = COALESCE(EXCLUDED.account_id, subscriptions.account_id),
      payment_method = COALESCE(EXCLUDED.payment_method, subscriptions.payment_method),
      next_due_at = COALESCE(EXCLUDED.next_due_at, subscriptions.next_due_at),
      reminder_days = EXCLUDED.reminder_days,
      notes = COALESCE(EXCLUDED.notes, subscriptions.notes),
      logo_url = COALESCE(EXCLUDED.logo_url, subscriptions.logo_url),
      source = 'detected',
      updated_at = NOW()
    RETURNING
      id, user_id::text AS user_id, merchant_key, name, status, billing_cycle, interval_days,
      amount_cents::text AS amount_cents, currency, category_id, NULL::text AS category,
      account_id, NULL::text AS account, payment_method, started_at::date::text AS started_at,
      next_due_at::date::text AS next_due_at,
      CASE WHEN next_due_at IS NULL THEN NULL ELSE (next_due_at - CURRENT_DATE)::int END AS days_until_next,
      reminder_days, notes, logo_url, source, created_at::text AS created_at, updated_at::text AS updated_at
  `;
  return toRecord(row!);
}
