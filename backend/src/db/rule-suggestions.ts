import { createSmartRule, normalizeRuleTags, type SmartRuleRow } from "./smart-rules.js";
import { sql } from "./index.js";

export type RuleSuggestionStatus = "pending" | "accepted" | "dismissed";

export interface RuleSuggestionRow {
  id: string;
  user_id: number;
  source: "correction" | "statement_row" | "bulk_correction";
  source_entity_type: string | null;
  source_entity_id: string | null;
  merchant: string | null;
  pattern: string;
  match_scope: "merchant" | "description" | "raw_text" | "any";
  match_type: "contains" | "equals" | "regex";
  category_id: string | null;
  category: string | null;
  account_id: string | null;
  account: string | null;
  tag_names: string[];
  reason: string;
  status: RuleSuggestionStatus;
  smart_rule_id: string | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
}

export interface RuleSuggestionInput {
  source: RuleSuggestionRow["source"];
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  merchant?: string | null;
  pattern: string;
  matchScope?: RuleSuggestionRow["match_scope"];
  matchType?: RuleSuggestionRow["match_type"];
  categoryId?: string | null;
  accountId?: string | null;
  tagNames?: string[];
  reason: string;
}

function normalizePattern(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

export function suggestionPatternFromText(input: {
  merchant?: string | null;
  description?: string | null;
}): string | null {
  const merchant = normalizePattern(input.merchant ?? "");
  if (merchant.length >= 3) return merchant;
  const description = normalizePattern(input.description ?? "");
  if (description.length < 3) return null;
  return description.split(/\s+/).slice(0, 5).join(" ");
}

export async function upsertRuleSuggestion(
  userId: number,
  input: RuleSuggestionInput,
): Promise<RuleSuggestionRow | null> {
  const pattern = normalizePattern(input.pattern);
  if (!pattern || (!input.categoryId && !input.accountId && !(input.tagNames ?? []).length)) {
    return null;
  }
  const tagNames = normalizeRuleTags(input.tagNames);

  const [row] = await sql<RuleSuggestionRow[]>`
    WITH upserted AS (
      INSERT INTO rule_suggestions (
        user_id,
        source,
        source_entity_type,
        source_entity_id,
        merchant,
        pattern,
        match_scope,
        match_type,
        category_id,
        account_id,
        tag_names,
        reason
      )
      VALUES (
        ${userId},
        ${input.source},
        ${input.sourceEntityType ?? null},
        ${input.sourceEntityId ?? null},
        ${input.merchant ?? null},
        ${pattern},
        ${input.matchScope ?? "any"},
        ${input.matchType ?? "contains"},
        ${input.categoryId ?? null},
        ${input.accountId ?? null},
        ${tagNames}::text[],
        ${input.reason}
      )
      ON CONFLICT (user_id, lower(pattern)) WHERE status = 'pending'
      DO UPDATE SET
        reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        source_entity_type = EXCLUDED.source_entity_type,
        source_entity_id = EXCLUDED.source_entity_id,
        merchant = COALESCE(EXCLUDED.merchant, rule_suggestions.merchant),
        category_id = COALESCE(EXCLUDED.category_id, rule_suggestions.category_id),
        account_id = COALESCE(EXCLUDED.account_id, rule_suggestions.account_id),
        tag_names = CASE
          WHEN cardinality(EXCLUDED.tag_names) > 0 THEN EXCLUDED.tag_names
          ELSE rule_suggestions.tag_names
        END,
        updated_at = NOW()
      RETURNING *
    )
    SELECT upserted.id,
           upserted.user_id::bigint::int AS user_id,
           upserted.source,
           upserted.source_entity_type,
           upserted.source_entity_id::text AS source_entity_id,
           upserted.merchant,
           upserted.pattern,
           upserted.match_scope,
           upserted.match_type,
           upserted.category_id::text AS category_id,
           c.name AS category,
           upserted.account_id::text AS account_id,
           a.name AS account,
           upserted.tag_names,
           upserted.reason,
           upserted.status,
           upserted.smart_rule_id::text AS smart_rule_id,
           upserted.created_at,
           upserted.updated_at,
           upserted.decided_at
    FROM upserted
    LEFT JOIN categories c ON c.id = upserted.category_id AND c.user_id = upserted.user_id
    LEFT JOIN accounts a ON a.id = upserted.account_id AND a.user_id = upserted.user_id
  `;
  return row ?? null;
}

export async function listRuleSuggestions(
  userId: number,
  status: RuleSuggestionStatus = "pending",
): Promise<RuleSuggestionRow[]> {
  return sql<RuleSuggestionRow[]>`
    SELECT s.id,
           s.user_id::bigint::int AS user_id,
           s.source,
           s.source_entity_type,
           s.source_entity_id::text AS source_entity_id,
           s.merchant,
           s.pattern,
           s.match_scope,
           s.match_type,
           s.category_id::text AS category_id,
           c.name AS category,
           s.account_id::text AS account_id,
           a.name AS account,
           s.tag_names,
           s.reason,
           s.status,
           s.smart_rule_id::text AS smart_rule_id,
           s.created_at,
           s.updated_at,
           s.decided_at
    FROM rule_suggestions s
    LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
    LEFT JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
    WHERE s.user_id = ${userId}
      AND s.status = ${status}
    ORDER BY s.updated_at DESC, s.created_at DESC
    LIMIT 50
  `;
}

export async function acceptRuleSuggestion(
  userId: number,
  suggestionId: string,
): Promise<{ suggestion: RuleSuggestionRow; rule: SmartRuleRow }> {
  const [suggestion] = await listRuleSuggestions(userId, "pending").then((rows) =>
    rows.filter((row) => row.id === suggestionId),
  );
  if (!suggestion) throw Object.assign(new Error("Suggestion not found"), { statusCode: 404 });

  const rule = await createSmartRule(userId, {
    name: `Learn ${suggestion.pattern}`.slice(0, 80),
    priority: 50,
    match_scope: suggestion.match_scope,
    match_type: suggestion.match_type,
    pattern: suggestion.pattern,
    category_id: suggestion.category_id,
    account_id: suggestion.account_id,
    tag_names: suggestion.tag_names,
    review_status: "reviewed",
  });

  const [updated] = await sql<RuleSuggestionRow[]>`
    WITH updated AS (
      UPDATE rule_suggestions
      SET status = 'accepted',
          smart_rule_id = ${rule.id},
          decided_at = NOW(),
          updated_at = NOW()
      WHERE id = ${suggestionId}
        AND user_id = ${userId}
      RETURNING *
    )
    SELECT updated.id,
           updated.user_id::bigint::int AS user_id,
           updated.source,
           updated.source_entity_type,
           updated.source_entity_id::text AS source_entity_id,
           updated.merchant,
           updated.pattern,
           updated.match_scope,
           updated.match_type,
           updated.category_id::text AS category_id,
           c.name AS category,
           updated.account_id::text AS account_id,
           a.name AS account,
           updated.tag_names,
           updated.reason,
           updated.status,
           updated.smart_rule_id::text AS smart_rule_id,
           updated.created_at,
           updated.updated_at,
           updated.decided_at
    FROM updated
    LEFT JOIN categories c ON c.id = updated.category_id AND c.user_id = updated.user_id
    LEFT JOIN accounts a ON a.id = updated.account_id AND a.user_id = updated.user_id
  `;
  if (!updated) throw new Error("Failed to accept suggestion");
  return { suggestion: updated, rule };
}

export async function dismissRuleSuggestion(
  userId: number,
  suggestionId: string,
): Promise<RuleSuggestionRow | null> {
  const [row] = await sql<RuleSuggestionRow[]>`
    WITH updated AS (
      UPDATE rule_suggestions
      SET status = 'dismissed',
          decided_at = NOW(),
          updated_at = NOW()
      WHERE id = ${suggestionId}
        AND user_id = ${userId}
        AND status = 'pending'
      RETURNING *
    )
    SELECT updated.id,
           updated.user_id::bigint::int AS user_id,
           updated.source,
           updated.source_entity_type,
           updated.source_entity_id::text AS source_entity_id,
           updated.merchant,
           updated.pattern,
           updated.match_scope,
           updated.match_type,
           updated.category_id::text AS category_id,
           c.name AS category,
           updated.account_id::text AS account_id,
           a.name AS account,
           updated.tag_names,
           updated.reason,
           updated.status,
           updated.smart_rule_id::text AS smart_rule_id,
           updated.created_at,
           updated.updated_at,
           updated.decided_at
    FROM updated
    LEFT JOIN categories c ON c.id = updated.category_id AND c.user_id = updated.user_id
    LEFT JOIN accounts a ON a.id = updated.account_id AND a.user_id = updated.user_id
  `;
  return row ?? null;
}
