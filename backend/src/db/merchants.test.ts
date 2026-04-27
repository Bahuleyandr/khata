import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}));

vi.mock("./index.js", () => ({ sql: sqlMock }));

import { getOrCreateMerchantCanonical } from "./merchants.js";

beforeEach(() => {
  sqlMock.mockReset();
});

describe("getOrCreateMerchantCanonical", () => {
  it("returns null for null input without hitting the DB", async () => {
    expect(await getOrCreateMerchantCanonical(1, null)).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns null for empty / whitespace-only input", async () => {
    expect(await getOrCreateMerchantCanonical(1, "")).toBeNull();
    expect(await getOrCreateMerchantCanonical(1, "   ")).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns the existing merchant ID when SELECT finds a case-insensitive match", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "m1" }]); // SELECT hits
    const id = await getOrCreateMerchantCanonical(1, "  ZOMATO  IN  ");
    expect(id).toBe("m1");
    expect(sqlMock).toHaveBeenCalledOnce(); // no INSERT
    // Lookup uses lowercased + collapsed-whitespace string
    const args = sqlMock.mock.calls[0]!;
    expect(args[2]).toBe("zomato in");
  });

  it("creates a new canonical merchant when the SELECT misses, preserving original casing", async () => {
    sqlMock.mockResolvedValueOnce([]); // SELECT empty
    sqlMock.mockResolvedValueOnce([{ id: "m2" }]); // INSERT returns id
    const id = await getOrCreateMerchantCanonical(1, "  Blue  Tokai  ");
    expect(id).toBe("m2");
    expect(sqlMock).toHaveBeenCalledTimes(2);
    // INSERT preserves the trimmed + collapsed display casing ("Blue Tokai")
    const insertArgs = sqlMock.mock.calls[1]!;
    expect(insertArgs[2]).toBe("Blue Tokai");
  });

  it("collapses internal whitespace (multi-space, tabs) before lookup", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "m1" }]);
    await getOrCreateMerchantCanonical(1, "Big  Bazaar\t\tStore");
    const args = sqlMock.mock.calls[0]!;
    expect(args[2]).toBe("big bazaar store");
  });
});
