import type { FastifyInstance } from "fastify";
import { guessAccountFromText } from "../db/accounts.js";
import { recordAuditEvent } from "../db/audit.js";
import {
  getCaptureEvent,
  listCaptureEvents,
  markCaptureFailed,
  markCaptureIgnored,
  markCaptureProcessed,
  markCaptureReplayStarted,
  summarizeCaptureFailures,
  summarizeCaptureSources,
  summarizeCaptureStatuses,
  type CaptureSource,
  type CaptureStatus,
} from "../db/captures.js";
import { CAPTURE_FAILURE_KINDS, type CaptureFailureKind } from "../capture/failure-kind.js";
import { buildCaptureConfidence, reviewStatusFromConfidence } from "../capture/confidence.js";
import { getCategoryByName, getUserCategories } from "../db/categories.js";
import { insertExpense } from "../db/expenses.js";
import { getOverrides } from "../db/overrides.js";
import { applySmartRules } from "../db/smart-rules.js";
import { attachTagToExpense, getOrCreateTag } from "../db/tags.js";
import { classifyMessage } from "../ai/parse.js";
import { tryParseUpi } from "../upi/parse.js";
import { getSession } from "./auth.js";
import { todayIst } from "../lib/time.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const captureQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["pending", "processed", "failed", "ignored"] },
    source: {
      type: "string",
      enum: [
        "telegram_text",
        "telegram_photo",
        "telegram_voice",
        "telegram_document",
        "dashboard_manual",
        "statement_upload",
      ],
    },
    failure_kind: { type: "string", enum: CAPTURE_FAILURE_KINDS },
    q: { type: "string", minLength: 1, maxLength: 120 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

const captureParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: uuidPattern },
  },
} as const;

type CaptureQuery = {
  status?: CaptureStatus;
  source?: CaptureSource;
  failure_kind?: CaptureFailureKind;
  q?: string;
  limit?: number;
};

function todayIso(): string {
  return todayIst();
}

function dateFromIso(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function addTags(userId: number, expenseId: string, tagNames: string[]): Promise<void> {
  for (const rawName of tagNames) {
    const name = rawName.trim().toLowerCase().replace(/\s+/g, " ");
    if (!name) continue;
    const tagId = await getOrCreateTag(userId, name);
    if (tagId) await attachTagToExpense(expenseId, tagId);
  }
}

export async function capturesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: CaptureQuery }>(
    "/api/captures",
    { schema: { querystring: captureQuerySchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      return {
        captures: await listCaptureEvents(session.userId, {
          status: request.query.status,
          source: request.query.source,
          failureKind: request.query.failure_kind,
          q: request.query.q,
          limit: request.query.limit ?? 50,
          actorUserId: session.canManage ? undefined : session.actorUserId,
        }),
      };
    },
  );

  app.get("/api/captures/summary", async (request, reply) => {
    const session = await getSession(request, reply);
    if (!session) return;
    const scopedActorUserId = session.canManage ? undefined : session.actorUserId;
    const [failures, statuses, sources] = await Promise.all([
      summarizeCaptureFailures(session.userId, scopedActorUserId),
      summarizeCaptureStatuses(session.userId, scopedActorUserId),
      summarizeCaptureSources(session.userId, scopedActorUserId),
    ]);
    return { failures, statuses, sources };
  });

  app.post<{ Params: { id: string } }>(
    "/api/captures/:id/ignore",
    { schema: { params: captureParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;
      // Fetch first so we can enforce own-scope authz before mutating.
      const existing = await getCaptureEvent(session.userId, request.params.id);
      if (!existing) return reply.status(404).send({ error: "Capture not found" });
      if (!session.canManage && String(existing.actor_user_id) !== String(session.actorUserId)) {
        return reply.status(403).send({ error: "Access denied" });
      }
      const capture = await markCaptureIgnored(session.userId, request.params.id);
      if (!capture) return reply.status(404).send({ error: "Capture not found" });
      await recordAuditEvent({
        userId: session.userId,
        actorUserId: session.actorUserId,
        action: "capture.ignore",
        entityType: "capture_event",
        entityId: capture.id,
        after: capture,
      });
      return { ok: true, capture };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/captures/:id/replay",
    { schema: { params: captureParamsSchema } },
    async (request, reply) => {
      const session = await getSession(request, reply);
      if (!session) return;

      const capture = await getCaptureEvent(session.userId, request.params.id);
      if (!capture) return reply.status(404).send({ error: "Capture not found" });
      if (!session.canManage && String(capture.actor_user_id) !== String(session.actorUserId)) {
        return reply.status(403).send({ error: "Access denied" });
      }
      if (!capture.raw_text) return reply.status(422).send({ error: "Only text captures can be replayed here" });
      if (capture.status === "processed" || capture.status === "ignored") {
        return reply.status(409).send({ error: `Cannot replay ${capture.status} captures` });
      }
      if (!capture.diagnosis.replayable) {
        return reply.status(409).send({ error: "This failure is not replayable" });
      }

      try {
        await markCaptureReplayStarted(session.userId, capture.id);
        const categories = await getUserCategories(session.userId);
        const categoryNames = categories.map((category) => category.name);
        const overrides = await getOverrides(session.userId);
        const rawText = capture.raw_text;

        let amountCents: number;
        let currency = "INR";
        let description: string;
        let merchant: string | null;
        let occurredAt: Date;
        let categoryId: string | null = null;
        let reviewStatus: "needs_review" | "reviewed" | "ignored" = "needs_review";

        const upi = tryParseUpi(rawText);
        if (upi) {
          amountCents = Math.round(upi.amountRupees * 100);
          merchant = upi.merchant;
          description = `${upi.app.toUpperCase()} payment${upi.merchant ? ` to ${upi.merchant}` : ""}`;
          occurredAt = dateFromIso(upi.occurredOn ?? todayIso()) ?? new Date();
        } else {
          const classified = await classifyMessage(rawText, categoryNames, overrides, todayIso());
          if (classified.type !== "expense") {
            await markCaptureFailed(session.userId, capture.id, "Replay did not classify as an expense");
            return reply.status(422).send({ error: "Replay did not classify as an expense" });
          }
          amountCents = Math.round(classified.data.amount * 100);
          currency = classified.data.currency || "INR";
          description = classified.data.description;
          merchant = classified.data.merchant;
          occurredAt = dateFromIso(classified.data.occurred_at) ?? new Date();
          const category = await getCategoryByName(session.userId, classified.data.category);
          categoryId = category?.id ?? null;
        }

        const rule = await applySmartRules(session.userId, {
          merchant,
          description,
          rawText,
        });
        const accountId = rule.account_id ?? (await guessAccountFromText(session.userId, rawText));
        categoryId = rule.category_id ?? categoryId;
        const confidence = buildCaptureConfidence({
          amountCents,
          occurredAt,
          merchant,
          description,
          categoryId,
          accountId,
          source: "telegram",
          ruleId: rule.rule_id,
          parser: upi ? "upi_regex" : "llm",
          rawText,
        });
        reviewStatus = rule.review_status ?? reviewStatusFromConfidence(reviewStatus, confidence);

        const expenseId = await insertExpense({
          userId: session.userId,
          amount_cents: amountCents,
          currency,
          description,
          merchant,
          category_id: categoryId,
          occurred_at: occurredAt,
          source: "telegram",
          raw_text: rawText,
          review_status: reviewStatus,
          account_id: accountId,
          capture_event_id: capture.id,
          confidence,
          paid_by_user_id: session.actorUserId,
          settlement_scope: session.userId < 0 ? "shared" : "personal",
          actorUserId: session.actorUserId,
        });
        await addTags(session.userId, expenseId, rule.tag_names);
        await markCaptureProcessed(session.userId, capture.id, expenseId, confidence);
        await recordAuditEvent({
          userId: session.userId,
          actorUserId: session.actorUserId,
          action: "capture.replay",
          entityType: "capture_event",
          entityId: capture.id,
          before: capture,
          after: { expense_id: expenseId },
          metadata: { rule_id: rule.rule_id, account_id: accountId },
        });
        return { ok: true, expense_id: expenseId };
      } catch (err) {
        await markCaptureFailed(session.userId, capture.id, (err as Error).message);
        throw err;
      }
    },
  );
}
