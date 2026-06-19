/**
 * Group SR — subscription reminder dedup (audit 2026-06-19 H7).
 *
 * A subscription whose next_due_at is already within several reminder
 * thresholds (e.g. created/seen at days_until=1 with reminder_days [7,3,1])
 * must send exactly ONE DM that run, not one per crossed threshold.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Api } from "grammy";
import { sql, truncateAll, seedBootstrapOwner } from "../test-support/db-helpers.js";
import { sendSubscriptionReminders } from "./subscription-renewal.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";
const OWNER_SR = 30001;

function fakeApi(): { api: Api; sent: Array<{ chatId: number; text: string }> } {
  const sent: Array<{ chatId: number; text: string }> = [];
  const api = {
    sendMessage: (chatId: number, text: string) => {
      sent.push({ chatId, text });
      return Promise.resolve(undefined);
    },
  } as unknown as Api;
  return { api, sent };
}

async function insertSub(p: {
  userId: number;
  nextDueInDays: number;
  reminderDays: number[];
}): Promise<void> {
  const due = new Date(Date.now() + p.nextDueInDays * 86400000).toISOString().slice(0, 10);
  await sql.unsafe(`
    INSERT INTO subscriptions
      (user_id, name, status, billing_cycle, amount_cents, currency, next_due_at, reminder_days)
    VALUES (${p.userId}, 'Netflix', 'active', 'monthly', 49900, 'INR',
            '${due}'::date, ARRAY[${p.reminderDays.join(",")}]::integer[])
  `);
}

describe.skipIf(skip)("SR: subscription reminder dedup (H7)", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_SR);
  });

  afterAll(async () => {
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("SR1: a sub within multiple thresholds sends exactly ONE DM (not one per threshold)", async () => {
    await insertSub({ userId: OWNER_SR, nextDueInDays: 1, reminderDays: [7, 3, 1] });
    const { api, sent } = fakeApi();
    await sendSubscriptionReminders(api);
    expect(sent.length).toBe(1);
    expect(sent[0]?.text).toContain("1d");
  });

  it("SR2: running twice in the same cycle does not re-send (guard holds)", async () => {
    await insertSub({ userId: OWNER_SR, nextDueInDays: 1, reminderDays: [7, 3, 1] });
    const { api, sent } = fakeApi();
    await sendSubscriptionReminders(api);
    await sendSubscriptionReminders(api);
    expect(sent.length).toBe(1);
  });
});
