import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}));

vi.mock("./index.js", () => ({ sql: sqlMock }));

import {
  attachTagToExpense,
  detachTagFromExpense,
  findTagByName,
  getOrCreateTag,
  getTagsForExpenses,
  listTagsWithCounts,
} from "./tags.js";

beforeEach(() => {
  sqlMock.mockReset();
});

describe("listTagsWithCounts", () => {
  it("returns rows ordered by count then name (left-join handles zero-use tags)", async () => {
    sqlMock.mockResolvedValue([
      { id: "t1", name: "work", count: 12 },
      { id: "t2", name: "lunch", count: 3 },
    ]);
    const result = await listTagsWithCounts(1);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("work");
  });
});

describe("getOrCreateTag", () => {
  it("normalizes whitespace + casing before insert", async () => {
    sqlMock.mockResolvedValue([{ id: "t1" }]);
    const id = await getOrCreateTag(1, "  Work  Stuff  ");
    expect(id).toBe("t1");
    // The normalized name should be the second template-arg (after userId)
    const args = sqlMock.mock.calls[0]!;
    expect(args[1]).toBe(1);
    expect(args[2]).toBe("work stuff");
  });

  it("returns null for empty / whitespace-only input (no SQL call)", async () => {
    expect(await getOrCreateTag(1, "")).toBeNull();
    expect(await getOrCreateTag(1, "   ")).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("findTagByName", () => {
  it("returns the tag when it exists", async () => {
    sqlMock.mockResolvedValue([{ id: "t1", name: "work" }]);
    const tag = await findTagByName(1, "Work");
    expect(tag).toEqual({ id: "t1", name: "work" });
  });

  it("returns null when not found", async () => {
    sqlMock.mockResolvedValue([]);
    expect(await findTagByName(1, "missing")).toBeNull();
  });

  it("returns null for empty input without hitting the DB", async () => {
    expect(await findTagByName(1, "")).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe("attach / detach", () => {
  it("attach issues an INSERT...ON CONFLICT DO NOTHING", async () => {
    sqlMock.mockResolvedValue([]);
    await attachTagToExpense("e1", "t1");
    expect(sqlMock).toHaveBeenCalledOnce();
    const fragment = (sqlMock.mock.calls[0]![0] as TemplateStringsArray).join("").toLowerCase();
    expect(fragment).toContain("insert into expense_tags");
    expect(fragment).toContain("on conflict do nothing");
  });

  it("detach returns true when a row was deleted, false otherwise", async () => {
    sqlMock.mockResolvedValueOnce([{ expense_id: "e1" }]);
    expect(await detachTagFromExpense("e1", "t1")).toBe(true);

    sqlMock.mockResolvedValueOnce([]);
    expect(await detachTagFromExpense("e1", "t1")).toBe(false);
  });
});

describe("getTagsForExpenses", () => {
  it("returns an empty Map for an empty input array (no SQL call)", async () => {
    const result = await getTagsForExpenses([]);
    expect(result.size).toBe(0);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("groups rows by expense_id with names in array order", async () => {
    sqlMock.mockResolvedValue([
      { expense_id: "e1", name: "lunch" },
      { expense_id: "e1", name: "work" },
      { expense_id: "e2", name: "personal" },
    ]);
    const result = await getTagsForExpenses(["e1", "e2"]);
    expect(result.size).toBe(2);
    expect(result.get("e1")).toEqual(["lunch", "work"]);
    expect(result.get("e2")).toEqual(["personal"]);
  });
});
