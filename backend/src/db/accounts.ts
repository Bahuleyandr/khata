import { sql } from "./index.js";

export type AccountType = "bank" | "card" | "cash" | "wallet" | "upi" | "other";

export interface AccountRow {
  id: string;
  user_id: number;
  name: string;
  type: AccountType;
  institution: string | null;
  last_four: string | null;
  is_default: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AccountInput {
  name: string;
  type?: AccountType;
  institution?: string | null;
  last_four?: string | null;
  is_default?: boolean;
}

export function normalizeAccountName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLastFour(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().replace(/\D+/g, "");
  return normalized ? normalized.slice(-4) : null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

export async function listAccounts(
  userId: number,
  options: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  return sql<AccountRow[]>`
    SELECT id,
           user_id::bigint::int AS user_id,
           name,
           type,
           institution,
           last_four,
           is_default,
           archived_at,
           created_at,
           updated_at
    FROM accounts
    WHERE user_id = ${userId}
      ${options.includeArchived === true ? sql`` : sql`AND archived_at IS NULL`}
    ORDER BY is_default DESC, name ASC
  `;
}

export async function accountBelongsToUser(userId: number, accountId: string): Promise<boolean> {
  const [row] = await sql<Array<{ id: string }>>`
    SELECT id
    FROM accounts
    WHERE id = ${accountId}
      AND user_id = ${userId}
      AND archived_at IS NULL
    LIMIT 1
  `;
  return !!row;
}

export async function getAccountById(userId: number, accountId: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    SELECT id,
           user_id::bigint::int AS user_id,
           name,
           type,
           institution,
           last_four,
           is_default,
           archived_at,
           created_at,
           updated_at
    FROM accounts
    WHERE id = ${accountId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return row ?? null;
}

export async function createAccount(userId: number, input: AccountInput): Promise<AccountRow> {
  const name = normalizeAccountName(input.name);
  const type = input.type ?? "card";
  const institution = normalizeNullableText(input.institution);
  const lastFour = normalizeLastFour(input.last_four);
  const isDefault = input.is_default === true;

  return sql.begin(async (tx) => {
    if (isDefault) {
      await tx`
        UPDATE accounts
        SET is_default = FALSE,
            updated_at = NOW()
        WHERE user_id = ${userId}
          AND archived_at IS NULL
      `;
    }

    const [row] = await tx<AccountRow[]>`
      INSERT INTO accounts (user_id, name, type, institution, last_four, is_default)
      VALUES (${userId}, ${name}, ${type}, ${institution}, ${lastFour}, ${isDefault})
      RETURNING id,
                user_id::bigint::int AS user_id,
                name,
                type,
                institution,
                last_four,
                is_default,
                archived_at,
                created_at,
                updated_at
    `;
    if (!row) throw new Error("Failed to create account");
    return row;
  });
}

export async function updateAccount(
  userId: number,
  accountId: string,
  input: Partial<AccountInput>,
): Promise<AccountRow | null> {
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasType = Object.prototype.hasOwnProperty.call(input, "type");
  const hasInstitution = Object.prototype.hasOwnProperty.call(input, "institution");
  const hasLastFour = Object.prototype.hasOwnProperty.call(input, "last_four");
  const hasDefault = Object.prototype.hasOwnProperty.call(input, "is_default");

  const name = hasName && input.name !== undefined ? normalizeAccountName(input.name) : null;
  const type = input.type ?? "card";
  const institution = hasInstitution ? normalizeNullableText(input.institution) : null;
  const lastFour = hasLastFour ? normalizeLastFour(input.last_four) : null;
  const isDefault = input.is_default === true;

  return sql.begin(async (tx) => {
    if (hasDefault && isDefault) {
      await tx`
        UPDATE accounts
        SET is_default = FALSE,
            updated_at = NOW()
        WHERE user_id = ${userId}
          AND id <> ${accountId}
          AND archived_at IS NULL
      `;
    }

    const [row] = await tx<AccountRow[]>`
      UPDATE accounts
      SET name = CASE WHEN ${hasName} THEN ${name} ELSE name END,
          type = CASE WHEN ${hasType} THEN ${type} ELSE type END,
          institution = CASE WHEN ${hasInstitution} THEN ${institution} ELSE institution END,
          last_four = CASE WHEN ${hasLastFour} THEN ${lastFour} ELSE last_four END,
          is_default = CASE WHEN ${hasDefault} THEN ${isDefault} ELSE is_default END,
          updated_at = NOW()
      WHERE id = ${accountId}
        AND user_id = ${userId}
        AND archived_at IS NULL
      RETURNING id,
                user_id::bigint::int AS user_id,
                name,
                type,
                institution,
                last_four,
                is_default,
                archived_at,
                created_at,
                updated_at
    `;
    return row ?? null;
  });
}

export async function archiveAccount(userId: number, accountId: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    UPDATE accounts
    SET archived_at = NOW(),
        is_default = FALSE,
        updated_at = NOW()
    WHERE id = ${accountId}
      AND user_id = ${userId}
      AND archived_at IS NULL
    RETURNING id,
              user_id::bigint::int AS user_id,
              name,
              type,
              institution,
              last_four,
              is_default,
              archived_at,
              created_at,
              updated_at
  `;
  return row ?? null;
}

export async function guessAccountFromText(userId: number, text: string | null | undefined): Promise<string | null> {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack) return null;

  const accounts = await listAccounts(userId);
  let best: { id: string; score: number } | null = null;
  for (const account of accounts) {
    let score = 0;
    const name = account.name.toLowerCase();
    const institution = account.institution?.toLowerCase() ?? "";
    if (name && haystack.includes(name)) score += 6;
    if (institution && haystack.includes(institution)) score += 5;
    if (account.last_four && haystack.includes(account.last_four)) score += 4;
    if (account.type === "card" && /\b(card|credit|amex|visa|mastercard)\b/i.test(text ?? "")) score += 1;
    if (/\bamex|american express\b/i.test(text ?? "") && /amex|american express/i.test(`${name} ${institution}`)) {
      score += 8;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: account.id, score };
    }
  }

  if (best) return best.id;
  const defaultAccount = accounts.find((account) => account.is_default);
  return defaultAccount?.id ?? null;
}
