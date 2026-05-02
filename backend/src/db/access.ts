import { config } from "../config.js";
import { sql } from "./index.js";

export type AccessRole = "owner" | "member";
export type AccessStatus = "active" | "pending" | "revoked";

export interface AccessProfile {
  firstName?: string | null;
  username?: string | null;
}

export interface AccessUser {
  telegramUserId: number;
  firstName: string | null;
  username: string | null;
  role: AccessRole;
  status: AccessStatus;
  ledgerUserId: number | null;
  invitedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  revokedAt: Date | null;
}

interface AccessUserRow {
  telegram_user_id: string;
  first_name: string | null;
  username: string | null;
  role: AccessRole;
  status: AccessStatus;
  ledger_user_id: string | null;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  revoked_at: Date | null;
}

function isBootstrapOwner(telegramUserId: number): boolean {
  return config.allowedTelegramUserIds.includes(telegramUserId);
}

function normalizeProfile(profile: AccessProfile = {}): Required<AccessProfile> {
  return {
    firstName: profile.firstName?.trim() || null,
    username: profile.username?.trim() || null,
  };
}

function mapAccessUser(row: AccessUserRow): AccessUser {
  return {
    telegramUserId: Number(row.telegram_user_id),
    firstName: row.first_name,
    username: row.username,
    role: row.role,
    status: row.status,
    ledgerUserId: row.ledger_user_id === null ? null : Number(row.ledger_user_id),
    invitedBy: row.invited_by === null ? null : Number(row.invited_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    revokedAt: row.revoked_at,
  };
}

function virtualBootstrapOwner(telegramUserId: number, profile: AccessProfile = {}): AccessUser {
  const normalized = normalizeProfile(profile);
  const now = new Date();
  return {
    telegramUserId,
    firstName: normalized.firstName,
    username: normalized.username,
    role: "owner",
    status: "active",
    ledgerUserId: telegramUserId,
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    revokedAt: null,
  };
}

export async function resolveSessionAccessForTelegramUser(
  telegramUserId: number,
  profile: AccessProfile = {},
): Promise<AccessUser | null> {
  if (isBootstrapOwner(telegramUserId)) {
    return virtualBootstrapOwner(telegramUserId, profile);
  }
  return resolveAccessForTelegramUser(telegramUserId, profile);
}

export async function ensureBootstrapAccessUsers(): Promise<void> {
  for (const telegramUserId of config.allowedTelegramUserIds) {
    await sql`
      INSERT INTO access_users (
        telegram_user_id,
        role,
        status,
        ledger_user_id
      )
      VALUES (
        ${telegramUserId},
        'owner',
        'active',
        ${telegramUserId}
      )
      ON CONFLICT (telegram_user_id) DO UPDATE
      SET role = 'owner',
          status = 'active',
          ledger_user_id = EXCLUDED.ledger_user_id,
          revoked_at = NULL,
          updated_at = NOW()
    `;
  }
}

export async function resolveAccessForTelegramUser(
  telegramUserId: number,
  profile: AccessProfile = {},
): Promise<AccessUser | null> {
  const normalized = normalizeProfile(profile);

  if (isBootstrapOwner(telegramUserId)) {
    await sql`
      INSERT INTO access_users (
        telegram_user_id,
        first_name,
        username,
        role,
        status,
        ledger_user_id,
        last_login_at
      )
      VALUES (
        ${telegramUserId},
        ${normalized.firstName},
        ${normalized.username},
        'owner',
        'active',
        ${telegramUserId},
        NOW()
      )
      ON CONFLICT (telegram_user_id) DO UPDATE
      SET first_name = COALESCE(EXCLUDED.first_name, access_users.first_name),
          username = COALESCE(EXCLUDED.username, access_users.username),
          role = 'owner',
          status = 'active',
          ledger_user_id = EXCLUDED.ledger_user_id,
          last_login_at = NOW(),
          revoked_at = NULL,
          updated_at = NOW()
    `;
  }

  const rows = await sql<AccessUserRow[]>`
    SELECT telegram_user_id::text AS telegram_user_id,
           first_name,
           username,
           role,
           status,
           ledger_user_id::text AS ledger_user_id,
           invited_by::text AS invited_by,
           created_at,
           updated_at,
           last_login_at,
           revoked_at
    FROM access_users
    WHERE telegram_user_id = ${telegramUserId}
  `;
  const row = rows[0];

  if (!row) {
    await sql`
      INSERT INTO access_users (
        telegram_user_id,
        first_name,
        username,
        status
      )
      VALUES (
        ${telegramUserId},
        ${normalized.firstName},
        ${normalized.username},
        'pending'
      )
      ON CONFLICT (telegram_user_id) DO UPDATE
      SET first_name = COALESCE(EXCLUDED.first_name, access_users.first_name),
          username = COALESCE(EXCLUDED.username, access_users.username),
          updated_at = NOW()
    `;
    return null;
  }

  if (row.status !== "active" || row.ledger_user_id === null) {
    await sql`
      UPDATE access_users
      SET first_name = COALESCE(${normalized.firstName}, first_name),
          username = COALESCE(${normalized.username}, username),
          updated_at = NOW()
      WHERE telegram_user_id = ${telegramUserId}
    `;
    return null;
  }

  await sql`
    UPDATE access_users
    SET first_name = COALESCE(${normalized.firstName}, first_name),
        username = COALESCE(${normalized.username}, username),
        last_login_at = NOW(),
        updated_at = NOW()
    WHERE telegram_user_id = ${telegramUserId}
  `;

  return mapAccessUser(row);
}

export async function listAccessUsers(ledgerUserId: number): Promise<AccessUser[]> {
  await ensureBootstrapAccessUsers();
  const rows = await sql<AccessUserRow[]>`
    SELECT telegram_user_id::text AS telegram_user_id,
           first_name,
           username,
           role,
           status,
           ledger_user_id::text AS ledger_user_id,
           invited_by::text AS invited_by,
           created_at,
           updated_at,
           last_login_at,
           revoked_at
    FROM access_users
    WHERE ledger_user_id = ${ledgerUserId}
    ORDER BY
      CASE role WHEN 'owner' THEN 0 ELSE 1 END,
      CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      telegram_user_id
  `;
  return rows.map(mapAccessUser);
}

export async function grantAccessUser(input: {
  ledgerUserId: number;
  actorUserId: number;
  telegramUserId: number;
  firstName?: string | null;
  username?: string | null;
  role: AccessRole;
}): Promise<AccessUser> {
  const normalized = normalizeProfile({
    firstName: input.firstName,
    username: input.username,
  });
  const role: AccessRole = input.telegramUserId === input.ledgerUserId ? "owner" : input.role;

  const rows = await sql<AccessUserRow[]>`
    INSERT INTO access_users (
      telegram_user_id,
      first_name,
      username,
      role,
      status,
      ledger_user_id,
      invited_by,
      revoked_at,
      updated_at
    )
    VALUES (
      ${input.telegramUserId},
      ${normalized.firstName},
      ${normalized.username},
      ${role},
      'active',
      ${input.ledgerUserId},
      ${input.actorUserId},
      NULL,
      NOW()
    )
    ON CONFLICT (telegram_user_id) DO UPDATE
    SET first_name = COALESCE(EXCLUDED.first_name, access_users.first_name),
        username = COALESCE(EXCLUDED.username, access_users.username),
        role = EXCLUDED.role,
        status = 'active',
        ledger_user_id = EXCLUDED.ledger_user_id,
        invited_by = EXCLUDED.invited_by,
        revoked_at = NULL,
        updated_at = NOW()
    RETURNING telegram_user_id::text AS telegram_user_id,
              first_name,
              username,
              role,
              status,
              ledger_user_id::text AS ledger_user_id,
              invited_by::text AS invited_by,
              created_at,
              updated_at,
              last_login_at,
              revoked_at
  `;
  return mapAccessUser(rows[0]!);
}

export async function updateAccessUserRole(input: {
  ledgerUserId: number;
  actorUserId: number;
  telegramUserId: number;
  role: AccessRole;
}): Promise<AccessUser | null> {
  if (input.telegramUserId === input.ledgerUserId && input.role !== "owner") return null;
  const rows = await sql<AccessUserRow[]>`
    UPDATE access_users
    SET role = ${input.role},
        invited_by = ${input.actorUserId},
        updated_at = NOW()
    WHERE ledger_user_id = ${input.ledgerUserId}
      AND telegram_user_id = ${input.telegramUserId}
      AND status = 'active'
    RETURNING telegram_user_id::text AS telegram_user_id,
              first_name,
              username,
              role,
              status,
              ledger_user_id::text AS ledger_user_id,
              invited_by::text AS invited_by,
              created_at,
              updated_at,
              last_login_at,
              revoked_at
  `;
  return rows[0] ? mapAccessUser(rows[0]) : null;
}

export async function revokeAccessUser(input: {
  ledgerUserId: number;
  actorUserId: number;
  telegramUserId: number;
}): Promise<AccessUser | null> {
  if (input.telegramUserId === input.ledgerUserId) return null;
  const rows = await sql<AccessUserRow[]>`
    UPDATE access_users
    SET status = 'revoked',
        invited_by = ${input.actorUserId},
        revoked_at = NOW(),
        updated_at = NOW()
    WHERE ledger_user_id = ${input.ledgerUserId}
      AND telegram_user_id = ${input.telegramUserId}
      AND status <> 'revoked'
    RETURNING telegram_user_id::text AS telegram_user_id,
              first_name,
              username,
              role,
              status,
              ledger_user_id::text AS ledger_user_id,
              invited_by::text AS invited_by,
              created_at,
              updated_at,
              last_login_at,
              revoked_at
  `;
  return rows[0] ? mapAccessUser(rows[0]) : null;
}
