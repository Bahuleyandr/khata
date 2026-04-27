import { schedule } from "node-cron";
import { Api, InputFile } from "grammy";
import {
  getBudgetsWithMtd,
  getDigestState,
  upsertDigestState,
  getDistinctUsersWithBudgets,
} from "../db/budgets.js";
import { getDistinctUsersWithExpensesIn } from "../db/query.js";
import { userHasExpenseToday } from "../db/expenses.js";
import { buildMonthlyXlsx, previousMonthBounds } from "../export/xlsx.js";
import { config } from "../config.js";
import { sql } from "../db/index.js";

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

export async function expireOldBotSessions(): Promise<void> {
  await sql`DELETE FROM bot_sessions WHERE expires_at < NOW()`;
}

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

/**
 * Send the previous month's full xlsx export to every user that had at least
 * one expense in that range. DM only — no group chats. Runs on the 1st.
 */
export async function runMonthlyExport(botApi: Api): Promise<void> {
  const { start, end, label, rangeKey } = previousMonthBounds();
  const users = await getDistinctUsersWithExpensesIn(start, end);

  for (const userId of users) {
    try {
      const { buffer, filename, rowCount, totalCents, currency } = await buildMonthlyXlsx(
        userId,
        start,
        end,
        rangeKey,
      );
      if (rowCount === 0) continue;
      const totalDisplay = `${currency === "INR" ? "₹" : currency + " "}${(totalCents / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
      await botApi.sendDocument(userId, new InputFile(buffer, filename), {
        caption: `📊 ${label} — ${rowCount} expense${rowCount !== 1 ? "s" : ""}, ${totalDisplay}`,
      });
    } catch (err) {
      console.error(`Monthly export for user ${userId}:`, err);
    }
  }
}

/**
 * Daily 9pm IST nudge — for each allowlisted user that hasn't logged
 * anything today, send a gentle "anything to log?" prompt. Kills the
 * "I forgot to log it" failure mode that wrecks most personal trackers.
 */
export async function runNightlyNudge(botApi: Api): Promise<void> {
  for (const userId of config.allowedTelegramUserIds) {
    try {
      if (await userHasExpenseToday(userId)) continue;
      await botApi.sendMessage(
        userId,
        "👀 Anything to log today?\n_If not, all good — see you tomorrow._",
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      console.error(`Nightly nudge for user ${userId}:`, err);
    }
  }
}

export function startBudgetCrons(botApi: Api): void {
  // Daily nudge + session expiry at 09:00 UTC
  schedule("0 9 * * *", () => {
    runDailyBudgetNudge(botApi).catch((err) =>
      console.error("Daily budget nudge error:", err),
    );
    expireOldBotSessions().catch((err) =>
      console.error("Bot session expiry error:", err),
    );
  });

  // 1st of the month at 08:00 UTC: budget digest, then monthly xlsx export.
  schedule("0 8 1 * *", () => {
    runMonthlyDigest(botApi).catch((err) =>
      console.error("Monthly digest cron error:", err),
    );
    runMonthlyExport(botApi).catch((err) =>
      console.error("Monthly export cron error:", err),
    );
  });

  // Daily 9pm IST nudge (= 15:30 UTC) — "anything to log today?"
  schedule("30 15 * * *", () => {
    runNightlyNudge(botApi).catch((err) =>
      console.error("Nightly nudge cron error:", err),
    );
  });

  console.log(
    "Crons registered: budget nudge + session expiry @09:00 UTC, monthly digest + xlsx export @08:00 UTC on 1st, nightly nudge @15:30 UTC (21:00 IST).",
  );
}
