const REDACT_PATTERNS: RegExp[] = [
  // S3 presigned URL query params
  /X-Amz-[^&\s"']+=[^&\s"']*/gi,
  // Bearer tokens — must run before Authorization so the token isn't left behind
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  // Authorization headers (catches any remaining scheme after Bearer is gone)
  /Authorization:\s*\S+/gi,
  // Generic URLs (preserve the host, redact query string)
  /(\bhttps?:\/\/[^\s?#"']+)\?[^\s"']*/gi,
];

export function redactError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const pattern of REDACT_PATTERNS) {
    msg = msg.replace(pattern, (match, group1) =>
      group1 ? `${group1}?[redacted]` : '[redacted]'
    );
  }
  return msg;
}
