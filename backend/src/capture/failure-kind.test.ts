import { describe, expect, it } from "vitest";
import { classifyCaptureFailure } from "./failure-kind.js";

describe("capture failure classification", () => {
  it("groups receipt OCR and parsing failures by operator-useful reason", () => {
    expect(classifyCaptureFailure("OCR returned too little text")).toBe("no_text");
    expect(classifyCaptureFailure("Receipt parser found no expense")).toBe("not_receipt");
    expect(classifyCaptureFailure("No transactions found")).toBe("no_transactions");
    expect(classifyCaptureFailure("Unsupported file type: text/plain")).toBe("unsupported_file");
  });
});
