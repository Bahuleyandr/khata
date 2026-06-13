import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tryParseReceiptText } from "../receipt/parse.js";
import { tryParseUpi } from "../upi/parse.js";

type ParserCase =
  | {
      id: string;
      type: "upi";
      input: string;
      expect: Record<string, unknown>;
    }
  | {
      id: string;
      type: "receipt";
      input: string;
      expect: Record<string, unknown>;
    };

function fixturePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../fixtures/parser-cases.jsonl");
}

function normalize(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  return value;
}

function assertExpected(id: string, actual: Record<string, unknown> | null, expected: Record<string, unknown>): string[] {
  const failures: string[] = [];
  if (!actual) {
    return [`${id}: parser returned null`];
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = normalize(actual[key]);
    if (actualValue !== normalize(expectedValue)) {
      failures.push(`${id}: ${key} expected ${JSON.stringify(expectedValue)} got ${JSON.stringify(actualValue)}`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const raw = await readFile(fixturePath(), "utf8");
  const cases = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ParserCase);

  const failures: string[] = [];
  for (const testCase of cases) {
    if (testCase.type === "upi") {
      failures.push(...assertExpected(testCase.id, tryParseUpi(testCase.input) as unknown as Record<string, unknown> | null, testCase.expect));
    } else {
      failures.push(
        ...assertExpected(
          testCase.id,
          tryParseReceiptText(testCase.input, ["Food", "Travel", "Bills", "Other"], "2026-06-13") as unknown as Record<string, unknown> | null,
          testCase.expect,
        ),
      );
    }
  }

  if (failures.length > 0) {
    console.error(`Parser evaluation failed (${failures.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Parser evaluation passed (${cases.length} cases).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
