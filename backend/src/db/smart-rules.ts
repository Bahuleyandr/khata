import { sql } from "./index.js";

export type SmartRuleMatchScope = "merchant" | "description" | "raw_text" | "any";
export type SmartRuleMatchType = "contains" | "equals" | "regex";
export type SmartRuleReviewStatus = "needs_review" | "reviewed" | "ignored";

export interface SmartRuleRow {
  id: string;
  user_id: number;
  name: string;
  priority: number;
  enabled: boolean;
  match_scope: SmartRuleMatchScope;
  match_type: SmartRuleMatchType;
  pattern: string;
  category_id: string | null;
  category: string | null;
  account_id: string | null;
  account: string | null;
  tag_names: string[];
  review_status: SmartRuleReviewStatus | null;
  created_at: Date;
  updated_at: Date;
}

export interface SmartRuleInput {
  name: string;
  priority?: number;
  enabled?: boolean;
  match_scope?: SmartRuleMatchScope;
  match_type?: SmartRuleMatchType;
  pattern: string;
  category_id?: string | null;
  account_id?: string | null;
  tag_names?: string[];
  review_status?: SmartRuleReviewStatus | null;
}

export interface SmartRulePatchInput {
  name?: string;
  priority?: number;
  enabled?: boolean;
  match_scope?: SmartRuleMatchScope;
  match_type?: SmartRuleMatchType;
  pattern?: string;
  category_id?: string | null;
  account_id?: string | null;
  tag_names?: string[];
  review_status?: SmartRuleReviewStatus | null;
}

export interface SmartRuleApplication {
  rule_id: string | null;
  rule_name: string | null;
  category_id: string | null;
  account_id: string | null;
  tag_names: string[];
  review_status: SmartRuleReviewStatus | null;
}

export interface SmartRuleInputText {
  merchant?: string | null;
  description?: string | null;
  rawText?: string | null;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizePattern(value: string): string {
  return value.trim();
}

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeRuleTags(rawNames: string[] | undefined): string[] {
  if (!rawNames) return [];
  return Array.from(new Set(rawNames.map(normalizeTagName).filter(Boolean))).slice(0, 20);
}

export function validateRulePattern(matchType: SmartRuleMatchType, pattern: string): string | null {
  const normalized = normalizePattern(pattern);
  if (!normalized) return "Pattern is required";
  if (normalized.length > 240) return "Pattern is too long";
  if (matchType === "regex") {
    try {
      new RegExp(normalized, "i");
    } catch {
      return "Regex pattern is invalid";
    }
  }
  return null;
}

export async function listSmartRules(userId: number): Promise<SmartRuleRow[]> {
  return sql<SmartRuleRow[]>`
    SELECT r.id,
           r.user_id::bigint::int AS user_id,
           r.name,
           r.priority,
           r.enabled,
           r.match_scope,
           r.match_type,
           r.pattern,
           r.category_id::text AS category_id,
           c.name AS category,
           r.account_id::text AS account_id,
           a.name AS account,
           r.tag_names,
           r.review_status,
           r.created_at,
           r.updated_at
    FROM smart_rules r
    LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id
    LEFT JOIN accounts a ON a.id = r.account_id AND a.user_id = r.user_id
    WHERE r.user_id = ${userId}
    ORDER BY r.enabled DESC, r.priority ASC, r.created_at ASC
  `;
}

export async function createSmartRule(userId: number, input: SmartRuleInput): Promise<SmartRuleRow> {
  const name = normalizeName(input.name);
  const matchType = input.match_type ?? "contains";
  const pattern = normalizePattern(input.pattern);
  const validationError = validateRulePattern(matchType, pattern);
  if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });

  const [row] = await sql<SmartRuleRow[]>`
    WITH inserted AS (
      INSERT INTO smart_rules (
        user_id,
        name,
        priority,
        enabled,
        match_scope,
        match_type,
        pattern,
        category_id,
        account_id,
        tag_names,
        review_status
      )
      VALUES (
        ${userId},
        ${name},
        ${input.priority ?? 100},
        ${input.enabled ?? true},
        ${input.match_scope ?? "any"},
        ${matchType},
        ${pattern},
        ${input.category_id ?? null},
        ${input.account_id ?? null},
        ${normalizeRuleTags(input.tag_names)}::text[],
        ${input.review_status ?? null}
      )
      RETURNING *
    )
    SELECT inserted.id,
           inserted.user_id::bigint::int AS user_id,
           inserted.name,
           inserted.priority,
           inserted.enabled,
           inserted.match_scope,
           inserted.match_type,
           inserted.pattern,
           inserted.category_id::text AS category_id,
           c.name AS category,
           inserted.account_id::text AS account_id,
           a.name AS account,
           inserted.tag_names,
           inserted.review_status,
           inserted.created_at,
           inserted.updated_at
    FROM inserted
    LEFT JOIN categories c ON c.id = inserted.category_id AND c.user_id = inserted.user_id
    LEFT JOIN accounts a ON a.id = inserted.account_id AND a.user_id = inserted.user_id
  `;
  if (!row) throw new Error("Failed to create rule");
  return row;
}

export async function updateSmartRule(
  userId: number,
  ruleId: string,
  input: SmartRulePatchInput,
): Promise<SmartRuleRow | null> {
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasPriority = Object.prototype.hasOwnProperty.call(input, "priority");
  const hasEnabled = Object.prototype.hasOwnProperty.call(input, "enabled");
  const hasScope = Object.prototype.hasOwnProperty.call(input, "match_scope");
  const hasType = Object.prototype.hasOwnProperty.call(input, "match_type");
  const hasPattern = Object.prototype.hasOwnProperty.call(input, "pattern");
  const hasCategory = Object.prototype.hasOwnProperty.call(input, "category_id");
  const hasAccount = Object.prototype.hasOwnProperty.call(input, "account_id");
  const hasTags = Object.prototype.hasOwnProperty.call(input, "tag_names");
  const hasReview = Object.prototype.hasOwnProperty.call(input, "review_status");

  const current = (await listSmartRules(userId)).find((rule) => rule.id === ruleId);
  if (!current) return null;
  const nextMatchType = input.match_type ?? current.match_type;
  const nextPattern = hasPattern && input.pattern !== undefined ? normalizePattern(input.pattern) : current.pattern;
  const validationError = validateRulePattern(nextMatchType, nextPattern);
  if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });

  const [row] = await sql<SmartRuleRow[]>`
    WITH updated AS (
      UPDATE smart_rules
      SET name = CASE WHEN ${hasName} THEN ${input.name ? normalizeName(input.name) : current.name} ELSE name END,
          priority = CASE WHEN ${hasPriority} THEN ${input.priority ?? current.priority} ELSE priority END,
          enabled = CASE WHEN ${hasEnabled} THEN ${input.enabled ?? current.enabled} ELSE enabled END,
          match_scope = CASE WHEN ${hasScope} THEN ${input.match_scope ?? current.match_scope} ELSE match_scope END,
          match_type = CASE WHEN ${hasType} THEN ${nextMatchType} ELSE match_type END,
          pattern = CASE WHEN ${hasPattern} THEN ${nextPattern} ELSE pattern END,
          category_id = CASE WHEN ${hasCategory} THEN ${input.category_id ?? null}::uuid ELSE category_id END,
          account_id = CASE WHEN ${hasAccount} THEN ${input.account_id ?? null}::uuid ELSE account_id END,
          tag_names = CASE WHEN ${hasTags} THEN ${normalizeRuleTags(input.tag_names)}::text[] ELSE tag_names END,
          review_status = CASE WHEN ${hasReview} THEN ${input.review_status ?? null} ELSE review_status END,
          updated_at = NOW()
      WHERE id = ${ruleId}
        AND user_id = ${userId}
      RETURNING *
    )
    SELECT updated.id,
           updated.user_id::bigint::int AS user_id,
           updated.name,
           updated.priority,
           updated.enabled,
           updated.match_scope,
           updated.match_type,
           updated.pattern,
           updated.category_id::text AS category_id,
           c.name AS category,
           updated.account_id::text AS account_id,
           a.name AS account,
           updated.tag_names,
           updated.review_status,
           updated.created_at,
           updated.updated_at
    FROM updated
    LEFT JOIN categories c ON c.id = updated.category_id AND c.user_id = updated.user_id
    LEFT JOIN accounts a ON a.id = updated.account_id AND a.user_id = updated.user_id
  `;
  return row ?? null;
}

export async function deleteSmartRule(userId: number, ruleId: string): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    DELETE FROM smart_rules
    WHERE id = ${ruleId}
      AND user_id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}

function matches(rule: SmartRuleRow, input: SmartRuleInputText): boolean {
  const fields: string[] = [];
  if (rule.match_scope === "merchant" || rule.match_scope === "any") fields.push(input.merchant ?? "");
  if (rule.match_scope === "description" || rule.match_scope === "any") fields.push(input.description ?? "");
  if (rule.match_scope === "raw_text" || rule.match_scope === "any") fields.push(input.rawText ?? "");
  const pattern = rule.pattern.trim();
  if (!pattern) return false;

  if (rule.match_type === "regex") {
    const regex = new RegExp(pattern, "i");
    return fields.some((field) => regex.test(field));
  }
  const normalizedPattern = pattern.toLowerCase();
  return fields.some((field) => {
    const normalized = field.toLowerCase().trim();
    if (!normalized) return false;
    if (rule.match_type === "equals") return normalized === normalizedPattern;
    return normalized.includes(normalizedPattern);
  });
}

export async function applySmartRules(
  userId: number,
  input: SmartRuleInputText,
): Promise<SmartRuleApplication> {
  const rules = (await listSmartRules(userId)).filter((rule) => rule.enabled);
  const rule = rules.find((candidate) => matches(candidate, input));
  if (!rule) {
    return {
      rule_id: null,
      rule_name: null,
      category_id: null,
      account_id: null,
      tag_names: [],
      review_status: null,
    };
  }
  return {
    rule_id: rule.id,
    rule_name: rule.name,
    category_id: rule.category_id,
    account_id: rule.account_id,
    tag_names: rule.tag_names,
    review_status: rule.review_status,
  };
}
