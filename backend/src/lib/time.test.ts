import { describe, it, expect } from "vitest";
import { APP_TIME_ZONE, formatIstDate, monthStartString, nowIstParts, todayIst } from "./time.js";

describe("lib/time", () => {
  it("uses Asia/Kolkata", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it("formatIstDate returns the IST calendar day for a late-UTC instant", () => {
    // 20:30Z on Jun 30 == 02:00 IST on Jul 1
    expect(formatIstDate(new Date("2026-06-30T20:30:00Z"))).toBe("2026-07-01");
  });

  it("formatIstDate is stable for a noon-UTC instant", () => {
    expect(formatIstDate(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01");
  });

  it("nowIstParts splits the IST day (1-based month)", () => {
    expect(nowIstParts(new Date("2026-06-30T20:30:00Z"))).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it("todayIst formats the given instant in IST", () => {
    expect(todayIst(new Date("2026-06-30T20:30:00Z"))).toBe("2026-07-01");
  });

  it("monthStartString rolls over year boundaries", () => {
    expect(monthStartString(2026, 6)).toBe("2026-06-01");
    expect(monthStartString(2026, 13)).toBe("2027-01-01");
    expect(monthStartString(2026, 0)).toBe("2025-12-01");
  });
});
