import type { FastifyInstance } from "fastify";
import { sql } from "../db/index.js";
import { recordAuditEvent } from "../db/audit.js";
import { findSubscriptionCandidates, type SubscriptionCandidate } from "../db/query.js";
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

function normalizeMerchantKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toApiSubscription(subscription: SubscriptionCandidate) {
  return {
    name: subscription.merchant,
    merchant_key: subscription.merchant_key,
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
      return { subscriptions: subscriptions.map(toApiSubscription) };
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
