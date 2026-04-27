function isRetriable(err: unknown): boolean {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    if (status !== undefined) return status === 529;
    const msg = err.message.toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 3): Promise<T> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable(err) || attempt === tries) throw err;
      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${tries} failed, retrying in ${delayMs}ms:`,
        err,
      );
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("withRetry: unreachable");
}
