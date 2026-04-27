import { describe, it, expect } from "vitest";
import { redactError } from "./redact.js";

describe("redactError", () => {
  it("redacts X-Amz-Signature in AWS SDK error messages", () => {
    const err = new Error(
      "RequestError: X-Amz-Signature=abc123&X-Amz-Credential=foo/bar"
    );
    const result = redactError(err);
    expect(result).not.toContain("X-Amz-Signature=abc123");
    expect(result).toContain("[redacted]");
  });

  it("redacts presigned URL query string in fetch errors", () => {
    const err = new Error(
      "fetch failed: https://bucket.s3.amazonaws.com/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600"
    );
    const result = redactError(err);
    expect(result).not.toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(result).toContain("https://bucket.s3.amazonaws.com/key?[redacted]");
  });

  it("passes through plain string errors unchanged", () => {
    const err = "No transactions found";
    const result = redactError(err);
    expect(result).toBe("No transactions found");
  });

  it("redacts Bearer token in Authorization header errors", () => {
    const err = new Error(
      "Request rejected: Authorization: Bearer tok123 is invalid"
    );
    const result = redactError(err);
    expect(result).not.toContain("tok123");
    expect(result).toContain("[redacted]");
  });
});
