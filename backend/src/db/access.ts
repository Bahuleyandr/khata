import { config } from "../config.js";
import { seedDefaultCategories } from "./categories.js";
import { sql } from "./index.js";

export type AccessRole = "owner" | "member";
export type AccessStatus = "active" | "pending" | "revoked";
export type LedgerKind = "personal" | "household";

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

export interface LedgerAccess {
  ledgerId: number;
  ledgerName: string;
  ledgerKind: LedgerKind;
  ownerTelegramUserId: number;
  telegramUserId: number;
  role: AccessRole;
  status: "active" | "revoked";
  canView: boolean;
  canAdd: boolean;
  canManage: boolean;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

export interface LedgerMember extends AccessUser {
  ledgerId: number;
  ledgerName: string;
  ledgerKind: LedgerKind;
  canView: boolean;
  canAdd: boolean;
  canManage: boolean;
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

interface LedgerAccessRow {
  ledger_id: string;
  ledger_name: string;
  ledger_kind: LedgerKind;
  owner_telegram_user_id: string;
  telegram_user_id: string;
  role: AccessRole;
  status: "active" | "revoked";
  can_view: boolean;
  can_add: boolean;
  can_manage: boolean;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
}

interface LedgerMemberRow extends AccessUserRow {
  ledger_id: string;
  ledger_name: string;
  ledger_kind: LedgerKind;
  can_view: boolean;
  can_add: boolean;
  can_manage: boolean;
}

export function householdLedgerId(ownerTelegramUserId: number): number {
  return -Math.abs(ownerTelegramUserId);
}

function isBootstrapOwner(telegramUserId: number): boolean {
  return config.allowedTelegramUserIds.includes(telegramUserId);
}

function normalizeProfile(profile: AccessProfile = {}): Required<AccessProfile> {
  return {
    firstName: profile.firstName?.trim() || null,
    username: profile.username?.trim().replace(/^@/, "") || null,
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

function mapLedgerAccess(row: LedgerAccessRow): LedgerAccess {
  return {
    ledgerId: Number(row.ledger_id),
    ledgerName: row.ledger_name,
    ledgerKind: row.ledger_kind,
    ownerTelegramUserId: Number(row.owner_telegram_user_id),
    telegramUserId: Number(row.telegram_user_id),
    role: row.role,
    status: row.status,
    canView: row.can_view,
    canAdd: row.can_add,
    canManage: row.can_manage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  };
}

function mapLedgerMember(row: LedgerMemberRow): LedgerMember {
  return {
    ...mapAccessUser(row),
    ledgerId: Number(row.ledger_id),
    ledgerName: row.ledger_name,
    ledgerKind: row.ledger_kind,
    canView: row.can_view,
    canAdd: row.can_add,
    canManage: row.can_manage,
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

function virtualLedgerAccess(
  telegramUserId: number,
  ledgerId: number,
  ledgerName: string,
  ledgerKind: LedgerKind,
): LedgerAccess {
  const now = new Date();
  return {
    ledgerId,
    ledgerName,
    ledgerKind,
    ownerTelegramUserId: telegramUserId,
    telegramUserId,
    role: "owner",
    status: "active",
    canView: true,
    canAdd: true,
    canManage: true,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
}

async function ensurePersonalLedger(telegramUserId: number): Promise<void> {
  await sql`
    INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
    VALUES (${telegramUserId}, ${telegramUserId}, 'Personal', 'personal')
    ON CONFLICT (id) DO UPDATE
    SET owner_telegram_user_id = EXCLUDED.owner_telegram_user_id,
        kind = 'personal',
        updated_at = NOW()
  `;
  await sql`
    INSERT INTO ledger_members (
      ledger_id,
      telegram_user_id,
      role,
      status,
      can_view,
      can_add,
      can_manage,
      revoked_at
    )
    VALUES (${telegramUserId}, ${telegramUserId}, 'owner', 'active', TRUE, TRUE, TRUE, NULL)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
    SET role = 'owner',
        status = 'active',
        can_view = TRUE,
        can_add = TRUE,
        can_manage = TRUE,
        revoked_at = NULL,
        updated_at = NOW()
  `;
  await seedDefaultCategories(telegramUserId);
}

async function ensureHouseholdLedger(ownerTelegramUserId: number): Promise<number> {
  const ledgerId = householdLedgerId(ownerTelegramUserId);
  await sql`
    INSERT INTO ledgers (id, owner_telegram_user_id, name, kind)
    VALUES (${ledgerId}, ${ownerTelegramUserId}, 'Household', 'household')
    ON CONFLICT (id) DO UPDATE
    SET owner_telegram_user_id = EXCLUDED.owner_telegram_user_id,
        kind = 'household',
        updated_at = NOW()
  `;
  await sql`
    INSERT INTO ledger_members (
      ledger_id,
      telegram_user_id,
      role,
      status,
      can_view,
      can_add,
      can_manage,
      revoked_at
    )
    VALUES (${ledgerId}, ${ownerTelegramUserId}, 'owner', 'active', TRUE, TRUE, TRUE, NULL)
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
    SET role = 'owner',
        status = 'active',
        can_view = TRUE,
        can_add = TRUE,
        can_manage = TRUE,
        revoked_at = NULL,
        updated_at = NOW()
  `;
  await seedDefaultCategories(ledgerId);
  return ledgerId;
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
    await ensurePersonalLedger(telegramUserId);
    await ensureHouseholdLedger(telegramUserId);
  }
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
    await ensurePersonalLedger(telegramUserId);
    await ensureHouseholdLedger(telegramUserId);
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

  if (row.status !== "active") {
    await sql`
      UPDATE access_users
      SET first_name = COALESCE(${normalized.firstName}, first_name),
          username = COALESCE(${normalized.username}, username),
          updated_at = NOW()
      WHERE telegram_user_id = ${telegramUserId}
    `;
    return null;
  }

  await ensurePersonalLedger(telegramUserId);
  const updatedRows = await sql<AccessUserRow[]>`
    UPDATE access_users
    SET first_name = COALESCE(${normalized.firstName}, first_name),
        username = COALESCE(${normalized.username}, username),
        ledger_user_id = ${telegramUserId},
        last_login_at = NOW(),
        updated_at = NOW()
    WHERE telegram_user_id = ${telegramUserId}
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

  return updatedRows[0] ? mapAccessUser(updatedRows[0]) : mapAccessUser(row);
}

export async function listLedgersForTelegramUser(telegramUserId: number): Promise<LedgerAccess[]> {
  if (isBootstrapOwner(telegramUserId)) {
    await ensureBootstrapAccessUsers();
  } else {
    await ensurePersonalLedger(telegramUserId);
  }

  const rows = await sql<LedgerAccessRow[]>`
    SELECT l.id::text AS ledger_id,
           l.name AS ledger_name,
           l.kind AS ledger_kind,
           l.owner_telegram_user_id::text AS owner_telegram_user_id,
           m.telegram_user_id::text AS telegram_user_id,
           m.role,
           m.status,
           m.can_view,
           m.can_add,
           m.can_manage,
           m.created_at,
           m.updated_at,
           m.revoked_at
    FROM ledger_members m
    JOIN ledgers l ON l.id = m.ledger_id
    WHERE m.telegram_user_id = ${telegramUserId}
      AND m.status = 'active'
      AND m.can_view = TRUE
    ORDER BY
      CASE l.kind WHEN 'personal' THEN 0 ELSE 1 END,
      l.name ASC,
      l.id ASC
  `;
  return rows.map(mapLedgerAccess);
}

export async function resolveLedgerForTelegramUser(input: {
  telegramUserId: number;
  requestedLedgerId?: number | null;
  requireWrite?: boolean;
}): Promise<LedgerAccess | null> {
  const requestedLedgerId = input.requestedLedgerId ?? input.telegramUserId;
  if (isBootstrapOwner(input.telegramUserId) && requestedLedgerId === input.telegramUserId) {
    return virtualLedgerAccess(input.telegramUserId, input.telegramUserId, "Personal", "personal");
  }

  if (isBootstrapOwner(input.telegramUserId)) {
    await ensureBootstrapAccessUsers();
  } else {
    await ensurePersonalLedger(input.telegramUserId);
  }

  const rows = await sql<LedgerAccessRow[]>`
    SELECT l.id::text AS ledger_id,
           l.name AS ledger_name,
           l.kind AS ledger_kind,
           l.owner_telegram_user_id::text AS owner_telegram_user_id,
           m.telegram_user_id::text AS telegram_user_id,
           m.role,
           m.status,
           m.can_view,
           m.can_add,
           m.can_manage,
           m.created_at,
           m.updated_at,
           m.revoked_at
    FROM ledger_members m
    JOIN ledgers l ON l.id = m.ledger_id
    WHERE m.ledger_id = ${requestedLedgerId}
      AND m.telegram_user_id = ${input.telegramUserId}
      AND m.status = 'active'
    LIMIT 1
  `;
  const access = rows[0] ? mapLedgerAccess(rows[0]) : null;
  if (!access || !access.canView) return null;
  if (input.requireWrite && !access.canAdd && !access.canManage) return null;
  return access;
}

export async function listAccessUsers(ledgerId: number): Promise<LedgerMember[]> {
  const rows = await sql<LedgerMemberRow[]>`
    SELECT m.ledger_id::text AS ledger_id,
           l.name AS ledger_name,
           l.kind AS ledger_kind,
           COALESCE(a.telegram_user_id, m.telegram_user_id)::text AS telegram_user_id,
           a.first_name,
           a.username,
           m.role,
           m.status,
           COALESCE(a.ledger_user_id, m.telegram_user_id)::text AS ledger_user_id,
           m.invited_by::text AS invited_by,
           m.created_at,
           m.updated_at,
           a.last_login_at,
           m.revoked_at,
           m.can_view,
           m.can_add,
           m.can_manage
    FROM ledger_members m
    JOIN ledgers l ON l.id = m.ledger_id
    LEFT JOIN access_users a ON a.telegram_user_id = m.telegram_user_id
    WHERE m.ledger_id = ${ledgerId}
    ORDER BY
      CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,
      CASE m.status WHEN 'active' THEN 0 ELSE 1 END,
      m.telegram_user_id
  `;
  return rows.map((row) =>
    mapLedgerMember({
      ...row,
      first_name: row.first_name ?? null,
      username: row.username ?? null,
      role: row.role,
      status: row.status === "active" ? "active" : "revoked",
      ledger_user_id: row.ledger_user_id ?? row.telegram_user_id,
    }),
  );
}

export async function grantAccessUser(input: {
  ledgerId: number;
  actorUserId: number;
  telegramUserId: number;
  firstName?: string | null;
  username?: string | null;
  role: AccessRole;
  canView?: boolean;
  canAdd?: boolean;
}): Promise<LedgerMember> {
  const normalized = normalizeProfile({
    firstName: input.firstName,
    username: input.username,
  });
  const role: AccessRole = input.role;
  const canManage = role === "owner";
  const canView = input.canView ?? true;
  const canAdd = canView ? input.canAdd ?? true : false;

  await ensurePersonalLedger(input.telegramUserId);
  await sql`
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
      ${input.telegramUserId},
      ${input.actorUserId},
      NULL,
      NOW()
    )
    ON CONFLICT (telegram_user_id) DO UPDATE
    SET first_name = COALESCE(EXCLUDED.first_name, access_users.first_name),
        username = COALESCE(EXCLUDED.username, access_users.username),
        status = 'active',
        ledger_user_id = EXCLUDED.ledger_user_id,
        invited_by = EXCLUDED.invited_by,
        revoked_at = NULL,
        updated_at = NOW()
  `;
  await sql`
    INSERT INTO ledger_members (
      ledger_id,
      telegram_user_id,
      role,
      status,
      can_view,
      can_add,
      can_manage,
      invited_by,
      revoked_at,
      updated_at
    )
    VALUES (
      ${input.ledgerId},
      ${input.telegramUserId},
      ${role},
      'active',
      ${canView},
      ${canAdd},
      ${canManage},
      ${input.actorUserId},
      NULL,
      NOW()
    )
    ON CONFLICT (ledger_id, telegram_user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        can_view = EXCLUDED.can_view,
        can_add = EXCLUDED.can_add,
        can_manage = EXCLUDED.can_manage,
        invited_by = EXCLUDED.invited_by,
        revoked_at = NULL,
        updated_at = NOW()
  `;
  const users = await listAccessUsers(input.ledgerId);
  return users.find((user) => user.telegramUserId === input.telegramUserId)!;
}

export async function updateAccessUserRole(input: {
  ledgerId: number;
  actorUserId: number;
  telegramUserId: number;
  role?: AccessRole;
  canView?: boolean;
  canAdd?: boolean;
}): Promise<LedgerMember | null> {
  const [ledger] = await sql<Array<{ owner_telegram_user_id: string }>>`
    SELECT owner_telegram_user_id::text AS owner_telegram_user_id
    FROM ledgers
    WHERE id = ${input.ledgerId}
    LIMIT 1
  `;
  if (!ledger) return null;
  const ownerTelegramUserId = Number(ledger.owner_telegram_user_id);
  if (input.telegramUserId === ownerTelegramUserId) return null;

  const role = input.role ?? null;
  const canView = input.canView ?? null;
  const canAdd = input.canAdd ?? null;
  const rows = await sql<Array<{ telegram_user_id: string }>>`
    UPDATE ledger_members
    SET role = COALESCE(${role}, role),
        can_view = COALESCE(${canView}, can_view),
        can_add = CASE
          WHEN ${canView} = FALSE THEN FALSE
          ELSE COALESCE(${canAdd}, can_add)
        END,
        can_manage = CASE
          WHEN ${role} = 'owner' THEN TRUE
          WHEN ${role} = 'member' THEN FALSE
          ELSE can_manage
        END,
        invited_by = ${input.actorUserId},
        updated_at = NOW()
    WHERE ledger_id = ${input.ledgerId}
      AND telegram_user_id = ${input.telegramUserId}
      AND status = 'active'
    RETURNING telegram_user_id::text AS telegram_user_id
  `;
  if (!rows[0]) return null;
  const users = await listAccessUsers(input.ledgerId);
  return users.find((user) => user.telegramUserId === input.telegramUserId) ?? null;
}

export async function revokeAccessUser(input: {
  ledgerId: number;
  actorUserId: number;
  telegramUserId: number;
}): Promise<LedgerMember | null> {
  const [ledger] = await sql<Array<{ owner_telegram_user_id: string }>>`
    SELECT owner_telegram_user_id::text AS owner_telegram_user_id
    FROM ledgers
    WHERE id = ${input.ledgerId}
    LIMIT 1
  `;
  if (!ledger) return null;
  if (input.telegramUserId === Number(ledger.owner_telegram_user_id)) return null;

  const usersBefore = await listAccessUsers(input.ledgerId);
  const before = usersBefore.find((user) => user.telegramUserId === input.telegramUserId) ?? null;
  if (!before) return null;

  const rows = await sql<Array<{ telegram_user_id: string }>>`
    UPDATE ledger_members
    SET status = 'revoked',
        can_view = FALSE,
        can_add = FALSE,
        can_manage = FALSE,
        invited_by = ${input.actorUserId},
        revoked_at = NOW(),
        updated_at = NOW()
    WHERE ledger_id = ${input.ledgerId}
      AND telegram_user_id = ${input.telegramUserId}
      AND status <> 'revoked'
    RETURNING telegram_user_id::text AS telegram_user_id
  `;
  return rows[0] ? { ...before, status: "revoked", canView: false, canAdd: false, canManage: false } : null;
}
