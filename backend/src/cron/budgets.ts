import { schedule } from "node-cron";
import type { Api } from "grammy";
import {
  getBudgetsWithMtd,
  getDigestState,
  upsertDigestState,
  getDistinctUsersWithBudgets,
} from "../db/budgets.js";

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function prevYearMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function daysLeftInMonth(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.getDate() - now.getDate();
}

function fmt(cents: number): string {
  return `₹${(cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const THRESHOLDS = [50, 75, 100] as const;

export async function runDailyBudgetNudge(botApi: Api): Promise<void> {
  const yearMonth = currentYearMonth();
  const daysLeft = daysLeftInMonth();
  const users = await getDistinctUsersWithBudgets();

  for (const userId of users) {
    const budgets = await getBudgetsWithMtd(userId, yearMonth);
    for (const b of budgets) {
      const lastNotified = await getDigestState(userId, b.category_id, yearMonth);
      const crossed = THRESHOLDS.find((t) => b.pct >= t && lastNotified < t);
      if (!crossed) continue;

      const msg =
        `📊 *${b.category_name}*: ${b.pct}% of monthly budget used ` +
        `(${fmt(b.spent_cents)} / ${fmt(b.target_cents)}), ` +
        `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left.`;
      try {
        await botApi.sendMessage(userId, msg, { parse_mode: "Markdown" });
        await upsertDigestState(userId, b.category_id, yearMonth, crossed);
      } catch (err) {
        console.error(`Budget nudge for user ${userId}:`, err);
      }
    }
  }
}

export async function runMonthlyDigest(botApi: Api): Promise<void> {
  const prevMonth = prevYearMonth();
  const users = await getDistinctUsersWithBudgets();

  for (const userId of users) {
    const budgets = await getBudgetsWithMtd(userId, prevMonth);
    if (budgets.length === 0) continue;

    const lines = budgets.map((b) => {
      const icon = b.pct > 100 ? "🔴" : b.pct >= 75 ? "🟡" : "🟢";
      return `${icon} *${b.category_name}*: ${fmt(b.spent_cents)} / ${fmt(b.target_cents)} (${b.pct}%)`;
    });

    const topVariances = budgets
      .filter((b) => b.spent_cents > b.target_cents)
      .sort((a, x) => (x.spent_cents - x.target_cents) - (a.spent_cents - a.target_cents))
      .slice(0, 3)
      .map((b) => `• *${b.category_name}*: over by ${fmt(b.spent_cents - b.target_cents)}`);

    let msg = `📅 *${prevMonth} Budget Summary*\n\n${lines.join("\n")}`;
    if (topVariances.length > 0) {
      msg += `\n\n🔴 *Overspends:*\n${topVariances.join("\n")}`;
    }

    try {
      await botApi.sendMessage(userId, msg, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`Monthly digest for user ${userId}:`, err);
    }
  }
}

export function startBudgetCrons(botApi: Api): void {
  // Daily nudge at 09:00 UTC
  schedule("0 9 * * *", () => {
    runDailyBudgetNudge(botApi).catch((err) =>
      console.error("Daily budget nudge error:", err),
    );
  });

  // Monthly digest on 1st at 08:00 UTC
  schedule("0 8 1 * *", () => {
    runMonthlyDigest(botApi).catch((err) =>
      console.error("Monthly digest cron error:", err),
    );
  });

  console.log("Budget crons registered: daily nudge @09:00 UTC, monthly digest @08:00 UTC on 1st.");
}
