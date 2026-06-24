import { describe, expect, it } from "vitest";
import { isPrivateChatType } from "./chat-policy.js";

describe("isPrivateChatType", () => {
  it("allows private or absent chat type", () => {
    expect(isPrivateChatType("private")).toBe(true);
    expect(isPrivateChatType(undefined)).toBe(true);
  });

  it("rejects group-like chat types", () => {
    expect(isPrivateChatType("group")).toBe(false);
    expect(isPrivateChatType("supergroup")).toBe(false);
    expect(isPrivateChatType("channel")).toBe(false);
  });
});
