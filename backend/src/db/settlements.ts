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
  const ownerTelegramId = Math.abs(ledgerId);

  // One query: current members (the participants) with their paid totals. Any
  // payment whose paid_by_user_id is NULL or points at a non-member (e.g. a
  // since-revoked member) is attributed to the ledger owner — who can never be
  // revoked from their own household — so every shared payment is credited to a
  // participant and the credited total equals the shared-expense total.
  // Otherwise dropped payments would make balances fail to net to zero
  // (audit 2026-06-19 H3).
  const rows = await sql<Array<{
    telegram_user_id: string;
    first_name: string | null;
    username: string | null;
    paid_cents: string;
  }>>`
    WITH members AS (
      SELECT lm.telegram_user_id,
             au.first_name,
             au.username
      FROM ledger_members lm
      LEFT JOIN access_users au ON au.telegram_user_id = lm.telegram_user_id
      WHERE lm.ledger_id = ${ledgerId}
        AND lm.status = 'active'
        AND lm.can_view = TRUE
    ),
    paid AS (
      SELECT CASE
               WHEN paid_by_user_id IN (SELECT telegram_user_id FROM members)
                 THEN paid_by_user_id
               ELSE ${ownerTelegramId}
             END AS telegram_user_id,
             SUM(amount_cents) AS paid_cents
      FROM expenses
      WHERE user_id = ${ledgerId}
        AND settlement_scope IN ('shared', 'reimbursable')
        AND occurred_at >= ${bounds.start}::date
        AND occurred_at < (${bounds.end}::date + INTERVAL '1 day')
      GROUP BY 1
    )
    SELECT members.telegram_user_id::text AS telegram_user_id,
           members.first_name,
           members.username,
           COALESCE(paid.paid_cents, 0)::text AS paid_cents
    FROM members
    LEFT JOIN paid ON paid.telegram_user_id = members.telegram_user_id
    ORDER BY members.telegram_user_id ASC
  `;

  const memberCount = Math.max(rows.length, 1);
  const total = rows.reduce((sum, r) => sum + Number(r.paid_cents), 0);

  // Equal split with deterministic remainder distribution: the fair shares sum
  // EXACTLY to `total` (no Math.round residual that would leave balances un-net).
  // Members are in stable telegram_user_id order; the first `remainder` of them
  // each carry one extra cent.
  const base = Math.floor(total / memberCount);
  const remainder = total - base * memberCount;

  const payers: HouseholdSettlementPayer[] = rows
    .map((r, i) => {
      const fairShare = base + (i < remainder ? 1 : 0);
      const paid = Number(r.paid_cents);
      return {
        telegram_user_id: r.telegram_user_id,
        first_name: r.first_name,
        username: r.username,
        paid_cents: String(paid),
        fair_share_cents: String(fairShare),
        balance_cents: String(paid - fairShare),
      };
    })
    .sort((a, b) => Number(b.balance_cents) - Number(a.balance_cents));

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
