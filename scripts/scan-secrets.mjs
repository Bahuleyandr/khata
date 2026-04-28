#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const files = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"));

const patterns = [
  {
    name: "Telegram bot token",
    re: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    name: "Google API key",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: "AWS/S3 access key",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  {
    name: "GitHub token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    name: "MiniMax key",
    re: /\b(?:MINIMAX_API_KEY|MiniMax API key)\s*[:=]\s*["']?(?!your_|REPLACE|test-)[A-Za-z0-9_-]{24,}/gi,
  },
  {
    name: "Likely committed secret assignment",
    re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY)[A-Z0-9_]*\b\s*[:=]\s*["']?(?!REPLACE|your_|generate_|test-|unused|config\b|process\b|postgres\b)[A-Za-z0-9_/+=:-]{16,}/g,
  },
];

const allowLine = /secret-scan:\s*allow/i;
const findings = [];

for (const file of files) {
  const fullPath = join(root, file);
  let text;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (allowLine.test(line)) continue;
    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      if (pattern.re.test(line)) {
        findings.push({
          file,
          line: index + 1,
          pattern: pattern.name,
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Secret scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.pattern}`);
  }
  console.error("If this is a known placeholder, rewrite it to avoid real-token shape.");
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} tracked files checked).`);
