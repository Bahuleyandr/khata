import { sql } from "./index.js";

export interface HouseholdSettlementPayer {
  telegram_user_id: string;
  first_name: string | null;
  username: string | null;
  paid_cents: string;
  fair_share_cents: string;
  balance_cents: string;
}

export interface HouseholdSettlementTransfer {
  from_telegram_user_id: string;
  to_telegram_user_id: string;
  amount_cents: string;
}

export interface HouseholdSettlement {
  period: {
    year: number;
    month: number;
    start: string;
    end: string;
    label: string;
  };
  total_cents: string;
  member_count: number;
  payers: HouseholdSettlementPayer[];
  transfers: HouseholdSettlementTransfer[];
}

function monthBounds(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = endDate.toISOString().slice(0, 10);
  const label = endDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

export async function computeHouseholdSettlement(
  ledgerId: number,
  year: number,
  month: number,
): Promise<HouseholdSettlement> {
  const bounds = monthBounds(year, month);
  const [summary] = await sql<Array<{ total_cents: string; member_count: number }>>`
    WITH members AS (
      SELECT telegram_user_id
      FROM ledger_members
      WHERE ledger_id = ${ledgerId}
        AND status = 'active'
        AND can_view = TRUE
    ),
    expenses_in_month AS (
      SELECT amount_cents
      FROM expenses
      WHERE user_id = ${ledgerId}
        AND settlement_scope IN ('shared', 'reimbursable')
        AND occurred_at >= ${bounds.start}::date
        AND occurred_at < (${bounds.end}::date + INTERVAL '1 day')
    )
    SELECT COALESCE(SUM(amount_cents), 0)::text AS total_cents,
           GREATEST((SELECT COUNT(*) FROM members), 1)::int AS member_count
    FROM expenses_in_month
  `;

  const total = Number(summary?.total_cents ?? 0);
  const memberCount = summary?.member_count ?? 1;
  const fairShare = Math.round(total / Math.max(memberCount, 1));

  const payers = await sql<HouseholdSettlementPayer[]>`
    WITH members AS (
      SELECT lm.telegram_user_id,
             COALESCE(au.first_name, NULL) AS first_name,
             COALESCE(au.username, NULL) AS username
      FROM ledger_members lm
      LEFT JOIN access_users au ON au.telegram_user_id = lm.telegram_user_id
      WHERE lm.ledger_id = ${ledgerId}
        AND lm.status = 'active'
        AND lm.can_view = TRUE
    ),
    paid AS (
      SELECT COALESCE(paid_by_user_id, ${Math.abs(ledgerId)}) AS telegram_user_id,
             SUM(amount_cents) AS paid_cents
      FROM expenses
      WHERE user_id = ${ledgerId}
        AND settlement_scope IN ('shared', 'reimbursable')
        AND occurred_at >= ${bounds.start}::date
        AND occurred_at < (${bounds.end}::date + INTERVAL '1 day')
      GROUP BY COALESCE(paid_by_user_id, ${Math.abs(ledgerId)})
    )
    SELECT members.telegram_user_id::text AS telegram_user_id,
           members.first_name,
           members.username,
           COALESCE(paid.paid_cents, 0)::text AS paid_cents,
           ${fairShare}::bigint::text AS fair_share_cents,
           (COALESCE(paid.paid_cents, 0) - ${fairShare})::bigint::text AS balance_cents
    FROM members
    LEFT JOIN paid ON paid.telegram_user_id = members.telegram_user_id
    ORDER BY balance_cents::bigint DESC
  `;

  const debtors = payers
    .map((payer) => ({ id: payer.telegram_user_id, cents: -Number(payer.balance_cents) }))
    .filter((payer) => payer.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const creditors = payers
    .map((payer) => ({ id: payer.telegram_user_id, cents: Number(payer.balance_cents) }))
    .filter((payer) => payer.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  const transfers: HouseholdSettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amount = Math.min(debtor.cents, creditor.cents);
    if (amount > 0) {
      transfers.push({
        from_telegram_user_id: debtor.id,
        to_telegram_user_id: creditor.id,
        amount_cents: String(amount),
      });
    }
    debtor.cents -= amount;
    creditor.cents -= amount;
    if (debtor.cents <= 0) debtorIndex += 1;
    if (creditor.cents <= 0) creditorIndex += 1;
  }

  return {
    period: { year, month, start: bounds.start, end: bounds.end, label: bounds.label },
    total_cents: String(total),
    member_count: memberCount,
    payers,
    transfers,
  };
}
