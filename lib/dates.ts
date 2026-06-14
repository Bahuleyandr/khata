/**
 * Format an ISO timestamp as YYYY-MM-DD in the *local* timezone, for prefilling
 * <input type="date">. Using toISOString() directly formats in UTC, so an
 * early-morning-IST expense (e.g. 02:00 IST == 20:30Z the previous day) would
 * prefill the wrong day and silently rewrite occurred_at on save. This mirrors
 * the local date the list shows via toLocaleDateString.
 */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
