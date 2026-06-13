import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { recordAuditEvent } from "../db/audit.js";
import { findSubscriptionCandidates, type SubscriptionCandidate } from "../db/query.js";
import {
  createSubscriptionRecord,
  deleteSubscriptionRecord,
  listSubscriptionRecords,
  summarizeSubscriptionRecords,
  updateSubscriptionRecord,
  upsertDetectedSubscriptionRecord,
  type BillingCycle,
  type SubscriptionRecordInput,
  type SubscriptionStatus,
} from "../db/subscription-records.js";
import { getSession } from "./auth.js";

type SubscriptionQuery = {
  include_ignored?: boolean;
};

type SubscriptionParams = {
  merchantKey: string;
};

type SubscriptionPreferenceBody = {
  merchant_name: string;
  status: "confirmed" | "ignored" | "inactive";
  note?: string | null;
};

type SubscriptionRecordBody = {
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
};

type SubscriptionRecordParams = {
  id: string;
};

type ConfirmDetectedBody = {
  merchant_name: string;
  cadence: SubscriptionCandidate["cadence"];
  amount_cents: number;
  currency?: string;
  next_due_at?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  payment_method?: string | null;
  notes?: string | null;
};

const subscriptionQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    include_ignored: { type: "boolean" },
  },
} as const;

const subscriptionParamsSchema = {
  type: "object",
  required: ["merchantKey"],
  additionalProperties: false,
  properties: {
    merchantKey: { type: "string", minLength: 1, maxLength: 240 },
  },
} as const;

const subscriptionPreferenceSchema = {
  type: "object",
  required: ["merchant_name", "status"],
  additionalProperties: false,
  properties: {
    merchant_name: { type: "string", minLength: 1, maxLength: 240 },
    status: { type: "string", enum: ["confirmed", "ignored", "inactive"] },
    note: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
  },
} as const;

const subscriptionRecordParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
  },
} as const;

const dateOrNullSchema = {
  anyOf: [
    { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    { type: "null" },
  ],
} as const;

const nullableUuidSchema = {
  anyOf: [
    { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
    { type: "null" },
  ],
} as const;

const subscriptionRecordSchema = {
  type: "object",
  required: ["name", "status", "billing_cycle", "amount_cents", "currency"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 240 },
    status: { type: "string", enum: ["active", "trial", "paused", "cancelled"] },
    billing_cycle: { type: "string", enum: ["weekly", "fortnightly", "monthly", "quarterly", "yearly", "custom"] },
    amount_cents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    category_id: nullableUuidSchema,
    account_id: nullableUuidSchema,
    payment_method: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
    started_at: dateOrNullSchema,
    next_due_at: dateOrNullSchema,
    interval_days: { anyOf: [{ type: "integer", minimum: 1, maximum: 3660 }, { type: "null" }] },
    reminder_days: {
      type: "array",
      maxItems: 5,
      items: { type: "integer", minimum: 0, maximum: 365 },
    },
    notes: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
    logo_url: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    merchant_key: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] },
  },
} as const;

const confirmDetectedSchema = {
  type: "object",
  required: ["merchant_name", "cadence", "amount_cents"],
  additionalProperties: false,
  properties: {
    merchant_name: { type: "string", minLength: 1, maxLength: 240 },
    cadence: { type: "string", enum: ["weekly", "fortnightly", "monthly", "quarterly", "irregular"] },
    amount_cents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    next_due_at: dateOrNullSchema,
    category_id: nullableUuidSchema,
    account_id: nullableUuidSchema,
    payment_method: { anyOf: [{ type: "string", maxLength: 120 }, { type: "null" }] },
    notes: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
  },
} as const;

function normalizeMerchantKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toApiSubscription(subscription: SubscriptionCandidate) {
  return {
    name: subscription.merchant,
    merchant_key: subscription.merchant_key,
    currency: subscription.currency,
    count: subscription.count,
    total_cents: subscription.total_cents,
    first_seen: subscription.first_seen,
    last_seen: subscription.last_seen,
    cadence: subscription.cadence,
    confidence: subscription.confidence,
    avg_amount_cents: subscription.avg_amount_cents,
    monthly_estimate_cents: subscription.monthly_estimate_cents,
    avg_interval_days: subscription.avg_interval_days,
    interval_jitter_days: subscription.interval_jitter_days,
    amount_variance_pct: subscription.amount_variance_pct,
    charge_dates: subscription.charge_dates,
    next_expected_at: subscription.next_expected_at,
    days_until_next: subscription.days_until_next,
    is_overdue: subscription.is_overdue,
    not_seen_this_month: subscription.not_seen_this_month,
    preference_status: subscription.preference_status,
  };
}

function cadenceToBillingCycle(cadence: SubscriptionCandidate["cadence"]): BillingCycle {
  if (cadence === "irregular") return "monthly";
  return cadence;
}

function recordInput(body: SubscriptionRecordBody): SubscriptionRecordInput {
  return {
    name: body.name,
    status: body.status,
    billing_cycle: body.billing_cycle,
    amount_cents: body.amount_cents,
    currency: body.currency,
    category_id: body.category_id,
    account_id: body.account_id,
    payment_method: body.payment_method,
    started_at: body.started_at,
    next_due_at: body.next_due_at,
    interval_days: body.interval_days,
    reminder_days: body.reminder_days,
    notes: body.notes,
    logo_url: body.logo_url,
    merchant_key: body.merchant_key,
  };
}

export async function subscriptionsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: SubscriptionQuery }>(
    "/api/subscriptions",
    { schema: { querystring: subscriptionQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const subscriptions = await findSubscriptionCandidates(session.userId, 6, 2, {
        includeIgnored: request.query.include_ignored === true,
      });
      const records = await listSubscriptionRecords(session.userId);
      return {
        subscriptions: subscriptions.map(toApiSubscription),
        records,
        summary: summarizeSubscriptionRecords(records),
      };
    },
  );

  app.post<{ Body: SubscriptionRecordBody }>(
    "/api/subscriptions/records",
    { schema: { body: subscriptionRecordSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const record = await createSubscriptionRecord(session.userId, recordInput(request.body));
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.create",
        entityType: "subscription",
        entityId: record.id,
        after: record,
      });
      return reply.status(201).send({ ok: true, record });
    },
  );

  app.put<{ Params: SubscriptionRecordParams; Body: SubscriptionRecordBody }>(
    "/api/subscriptions/records/:id",
    { schema: { params: subscriptionRecordParamsSchema, body: subscriptionRecordSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const record = await updateSubscriptionRecord(session.userId, request.params.id, recordInput(request.body));
      if (!record) return reply.status(404).send({ error: "Subscription not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.update",
        entityType: "subscription",
        entityId: record.id,
        after: record,
      });
      return { ok: true, record };
    },
  );

  app.delete<{ Params: SubscriptionRecordParams }>(
    "/api/subscriptions/records/:id",
    { schema: { params: subscriptionRecordParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const record = await deleteSubscriptionRecord(session.userId, request.params.id);
      if (!record) return reply.status(404).send({ error: "Subscription not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.delete",
        entityType: "subscription",
        entityId: record.id,
        before: record,
      });
      return { ok: true };
    },
  );

  app.post<{ Params: SubscriptionParams; Body: ConfirmDetectedBody }>(
    "/api/subscriptions/detections/:merchantKey/confirm",
    { schema: { params: subscriptionParamsSchema, body: confirmDetectedSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const merchantKey = normalizeMerchantKey(request.params.merchantKey);
      const merchantName = request.body.merchant_name.trim().replace(/\s+/g, " ");
      if (!merchantKey || !merchantName) {
        return reply.status(400).send({ error: "Merchant is required" });
      }

      const record = await upsertDetectedSubscriptionRecord(session.userId, {
        merchant_key: merchantKey,
        name: merchantName,
        status: "active",
        billing_cycle: cadenceToBillingCycle(request.body.cadence),
        amount_cents: request.body.amount_cents,
        currency: request.body.currency ?? "INR",
        next_due_at: request.body.next_due_at,
        category_id: request.body.category_id,
        account_id: request.body.account_id,
        payment_method: request.body.payment_method,
        notes: request.body.notes,
        reminder_days: [3],
      });

      const [preference] = await sql<Array<{ merchant_key: string; merchant_name: string; status: string; note: string | null }>>`
        INSERT INTO subscription_preferences (user_id, merchant_key, merchant_name, status, note)
        VALUES (${session.userId}, ${merchantKey}, ${merchantName}, 'confirmed', ${request.body.notes?.trim() || null})
        ON CONFLICT (user_id, merchant_key)
        DO UPDATE SET
          merchant_name = EXCLUDED.merchant_name,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING merchant_key, merchant_name, status, note
      `;

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.detected_confirm",
        entityType: "subscription",
        entityId: record.id,
        after: { record, preference },
        metadata: { merchant_key: merchantKey },
      });

      return { ok: true, record, preference };
    },
  );

  app.put<{ Params: SubscriptionParams; Body: SubscriptionPreferenceBody }>(
    "/api/subscriptions/:merchantKey",
    { schema: { params: subscriptionParamsSchema, body: subscriptionPreferenceSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const merchantKey = normalizeMerchantKey(request.params.merchantKey);
      const merchantName = request.body.merchant_name.trim().replace(/\s+/g, " ");
      if (!merchantKey || !merchantName) {
        return reply.status(400).send({ error: "Merchant is required" });
      }

      const [before] = await sql<Array<{ merchant_key: string; merchant_name: string; status: string; note: string | null }>>`
        SELECT merchant_key, merchant_name, status, note
        FROM subscription_preferences
        WHERE user_id = ${session.userId}
          AND merchant_key = ${merchantKey}
        LIMIT 1
      `;

      const [preference] = await sql<Array<{ merchant_key: string; merchant_name: string; status: string; note: string | null }>>`
        INSERT INTO subscription_preferences (user_id, merchant_key, merchant_name, status, note)
        VALUES (
          ${session.userId},
          ${merchantKey},
          ${merchantName},
          ${request.body.status},
          ${request.body.note?.trim() || null}
        )
        ON CONFLICT (user_id, merchant_key)
        DO UPDATE SET
          merchant_name = EXCLUDED.merchant_name,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING merchant_key, merchant_name, status, note
      `;

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.preference_set",
        entityType: "subscription",
        before: before ?? null,
        after: preference ?? null,
        metadata: { merchant_key: merchantKey },
      });

      return { ok: true, preference };
    },
  );

  app.delete<{ Params: SubscriptionParams }>(
    "/api/subscriptions/:merchantKey",
    { schema: { params: subscriptionParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const merchantKey = normalizeMerchantKey(request.params.merchantKey);
      const [deleted] = await sql<Array<{ merchant_key: string; merchant_name: string; status: string; note: string | null }>>`
        DELETE FROM subscription_preferences
        WHERE user_id = ${session.userId}
          AND merchant_key = ${merchantKey}
        RETURNING merchant_key, merchant_name, status, note
      `;

      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "subscription.preference_clear",
        entityType: "subscription",
        before: deleted ?? null,
        metadata: { merchant_key: merchantKey },
      });

      return { ok: true };
    },
  );
}
