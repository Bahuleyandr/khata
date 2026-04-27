import { describe, it, expect, vi } from "vitest";

// We mock config so the test doesn't require real env vars
vi.mock("../config.js", () => ({
  config: {
    allowedTelegramUserIds: [111111, 222222],
  },
}));

import { isAllowedUser } from "./auth.js";

describe("isAllowedUser", () => {
  it("returns true for a user in the allowlist", () => {
    expect(isAllowedUser(111111)).toBe(true);
  });

  it("returns true for a second allowed user", () => {
    expect(isAllowedUser(222222)).toBe(true);
  });

  it("returns false for an unknown user", () => {
    expect(isAllowedUser(999999)).toBe(false);
  });

  it("returns false for user id 0", () => {
    expect(isAllowedUser(0)).toBe(false);
  });
});
