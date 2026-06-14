import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({ config: { allowedOrigins: ["https://khata.example"] } }));

import { isTrustedMutationOrigin } from "./csrf.js";

describe("isTrustedMutationOrigin", () => {
  it("allows a same-origin request (origin matches host)", () => {
    expect(isTrustedMutationOrigin("https://khata.example", "khata.example", undefined)).toBe(true);
  });

  it("allows an allow-listed origin", () => {
    expect(isTrustedMutationOrigin("https://khata.example", "other.host", undefined)).toBe(true);
  });

  it("blocks an untrusted cross-site origin", () => {
    expect(isTrustedMutationOrigin("https://evil.example", "khata.example", undefined)).toBe(false);
  });

  it("blocks a no-Origin request that Sec-Fetch-Site marks cross-site", () => {
    expect(isTrustedMutationOrigin(undefined, "khata.example", "cross-site")).toBe(false);
  });

  it("allows a no-Origin same-origin request (Mini-App webview POST)", () => {
    expect(isTrustedMutationOrigin(undefined, "khata.example", "same-origin")).toBe(true);
  });

  it("allows a no-Origin request from a browser that sends neither header", () => {
    expect(isTrustedMutationOrigin(undefined, "khata.example", undefined)).toBe(true);
  });
});
