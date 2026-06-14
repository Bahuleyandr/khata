/**
 * Application timezone helpers.
 *
 * Khata is single-household and India-only, so the app timezone is a hardcoded
 * constant (India has no DST — a fixed +05:30). These helpers evaluate the
 * calendar day/month in IST via an explicit `timeZone`, so they are immune to
 * the Node process timezone — correctness does not depend on `TZ` on the pod.
 */
export const APP_TIME_ZONE = "Asia/Kolkata";

/** YYYY-MM-DD of an instant in IST. `en-CA` renders ISO-style YYYY-MM-DD. */
export function formatIstDate(instant: Date): string {
  return instant.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** Today's date as YYYY-MM-DD in IST. */
export function todayIst(now: Date = new Date()): string {
  return formatIstDate(now);
}

/** Current IST calendar parts (1-based month). */
export function nowIstParts(now: Date = new Date()): { year: number; month: number; day: number } {
  const [year, month, day] = formatIstDate(now).split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * First day (`YYYY-MM-01`) of a 1-based month, rolling the year when month1 < 1
 * or > 12 (e.g. `monthStartString(2026, 13)` → "2027-01-01"). Used for IST
 * month-window bounds.
 */
export function monthStartString(year: number, month1: number): string {
  const total = year * 12 + (month1 - 1);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
