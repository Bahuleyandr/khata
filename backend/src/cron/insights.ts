import { schedule } from "node-cron";
import { config } from "../config.js";
import { computeAndStoreInsightsForUser } from "../insights/compute.js";

/**
 * For each allowlisted user, recompute the v1 insight kinds and append fresh
 * rows to the `insights` table. Errors per user don't block other users.
 */
export async function runComputeInsights(): Promise<void> {
  for (const userId of config.allowedTelegramUserIds) {
    try {
      await computeAndStoreInsightsForUser(userId);
    } catch (err) {
      console.error(`Insights compute for user ${userId}:`, err);
    }
  }
}

export function startInsightsCron(): void {
  // 17:00 UTC (= 22:30 IST), 30min after the nightly nudge cron — captures
  // the day's full activity before insights are read the next morning.
  schedule("0 17 * * *", () => {
    runComputeInsights().catch((err) => console.error("Insights cron error:", err));
  });
  console.log("Insights cron registered: nightly @17:00 UTC (22:30 IST).");
}
