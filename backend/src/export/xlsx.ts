import ExcelJS from "exceljs";
import { getExpensesForExport, type ExportRow } from "../db/query.js";
import { nowIstParts, monthStartString } from "../lib/time.js";

export interface MonthlyXlsx {
  buffer: Buffer;
  filename: string;
  rowCount: number;
  totalCents: number;
  currency: string;
}

/**
 * Build a multi-sheet xlsx workbook for the given user + date range:
 *   Transactions — one row per expense, full detail
 *   Summary      — total + by-category aggregate
 *   By Merchant  — totals grouped by canonical merchant (falls back to raw)
 *   By Tag       — totals grouped by tag (one row per (expense, tag), so
 *                  totals are sums-with-overlap; intentional — gives "spend
 *                  on anything tagged #work" rather than "spend tagged
 *                  ONLY #work")
 *
 * Auto-filter is enabled on the Transactions sheet header row. Currency
 * formatting uses Excel's "#,##0.00" so amounts render as numbers (not
 * strings — sortable, summable in Excel).
 */
export async function buildMonthlyXlsx(
  userId: number,
  startDate: string,
  endDate: string,
  rangeLabel: string,
): Promise<MonthlyXlsx> {
  const rows = await getExpensesForExport(userId, startDate, endDate);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Khata";
  workbook.created = new Date();
  workbook.title = `Khata expenses — ${rangeLabel}`;

  // Sheet 1: Transactions ───────────────────────────────────────────────────
  const tx = workbook.addWorksheet("Transactions");
  tx.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Amount", key: "amount", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Category", key: "category", width: 18 },
    { header: "Merchant", key: "merchant", width: 28 },
    { header: "Canonical Merchant", key: "merchant_canonical", width: 28 },
    { header: "Description", key: "description", width: 35 },
    { header: "Tags", key: "tags", width: 22 },
    { header: "Source", key: "source", width: 12 },
  ];
  tx.getRow(1).font = { bold: true };
  for (const r of rows) {
    tx.addRow({
      date: r.date,
      amount: r.amount_cents / 100,
      currency: r.currency,
      category: r.category,
      merchant: r.merchant,
      merchant_canonical: r.merchant_canonical,
      description: r.description,
      tags: (r.tags ?? []).join(", "),
      source: r.source,
    });
  }
  if (rows.length > 0) {
    tx.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: tx.columns.length },
    };
    tx.views = [{ state: "frozen", ySplit: 1 }];
  }

  // Pre-aggregate for the other three sheets ────────────────────────────────
  const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const currency = rows[0]?.currency ?? "INR";

  const aggBy = (
    keyFn: (r: ExportRow) => string | null,
  ): Map<string, { totalCents: number; count: number }> => {
    const out = new Map<string, { totalCents: number; count: number }>();
    for (const r of rows) {
      const k = keyFn(r);
      if (k == null) continue;
      const cur = out.get(k) ?? { totalCents: 0, count: 0 };
      cur.totalCents += r.amount_cents;
      cur.count += 1;
      out.set(k, cur);
    }
    return out;
  };

  const byCategory = aggBy((r) => r.category);
  const byMerchant = aggBy((r) => r.merchant_canonical || r.merchant || null);
  const byTag = (() => {
    // One row per (expense, tag) so multi-tagged expenses count toward each tag.
    const out = new Map<string, { totalCents: number; count: number }>();
    for (const r of rows) {
      for (const tag of r.tags ?? []) {
        const cur = out.get(tag) ?? { totalCents: 0, count: 0 };
        cur.totalCents += r.amount_cents;
        cur.count += 1;
        out.set(tag, cur);
      }
    }
    return out;
  })();

  // Sheet 2: Summary ────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 28 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRows([
    { field: "Range", value: `${startDate} → ${endDate}` },
    { field: "Currency", value: currency },
    { field: "Transactions", value: rows.length },
    { field: "Total amount", value: totalCents / 100 },
    { field: "", value: "" },
    { field: "By category:", value: "" },
  ]);
  summary.getCell(`B${summary.rowCount - 2}`).numFmt = "#,##0.00";
  for (const [name, agg] of [...byCategory.entries()].sort(
    (a, b) => b[1].totalCents - a[1].totalCents,
  )) {
    const row = summary.addRow({ field: name, value: agg.totalCents / 100 });
    row.getCell(2).numFmt = "#,##0.00";
  }

  // Sheet 3: By Merchant ────────────────────────────────────────────────────
  const merch = workbook.addWorksheet("By Merchant");
  merch.columns = [
    { header: "Merchant", key: "merchant", width: 30 },
    { header: "Total", key: "total", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Count", key: "count", width: 8 },
  ];
  merch.getRow(1).font = { bold: true };
  for (const [name, agg] of [...byMerchant.entries()].sort(
    (a, b) => b[1].totalCents - a[1].totalCents,
  )) {
    merch.addRow({ merchant: name, total: agg.totalCents / 100, count: agg.count });
  }

  // Sheet 4: By Tag ─────────────────────────────────────────────────────────
  const tagSheet = workbook.addWorksheet("By Tag");
  tagSheet.columns = [
    { header: "Tag", key: "tag", width: 20 },
    { header: "Total", key: "total", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Count", key: "count", width: 8 },
  ];
  tagSheet.getRow(1).font = { bold: true };
  for (const [name, agg] of [...byTag.entries()].sort(
    (a, b) => b[1].totalCents - a[1].totalCents,
  )) {
    tagSheet.addRow({ tag: `#${name}`, total: agg.totalCents / 100, count: agg.count });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `khata-${rangeLabel}.xlsx`,
    rowCount: rows.length,
    totalCents,
    currency,
  };
}

/** Helper: previous calendar month bounds (YYYY-MM-DD strings + label) in UTC. */
export function previousMonthBounds(now: Date = new Date()): {
  start: string;
  end: string;
  label: string; // e.g. "March 2026"
  rangeKey: string; // e.g. "2026-03"
} {
  const { year, month } = nowIstParts(now);
  // `month` is the 1-based current IST month; the previous month start handles the Jan→Dec rollover.
  const start = monthStartString(year, month - 1); // "YYYY-MM-01"
  const [y, m] = start.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const rangeKey = `${y}-${String(m).padStart(2, "0")}`;
  return { start, end, label, rangeKey };
}

/** Helper: current calendar month bounds (UTC). */
export function currentMonthBounds(
  year: number,
  month: number,
): {
  start: string;
  end: string;
  label: string;
  rangeKey: string;
} {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month here is 1-12
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const rangeKey = `${year}-${String(month).padStart(2, "0")}`;
  return { start, end, label, rangeKey };
}
