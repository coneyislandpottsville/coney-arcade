import type { FieldRule, FieldValues, Game } from "./types.ts";
import { sanitizeInitials } from "./initials.ts";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Normalized = {
  submissionId: string;
  client: string;
  initials: string;
  fields: FieldValues;
  units: Record<string, bigint | null>;
  canonical: string;
};

export type NormalizeResult = { ok: true; value: Normalized } | { ok: false; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const scaleOf = (rule: FieldRule): number => 10 ** rule.precision;

const toUnits = (value: number, rule: FieldRule): number => Math.round(value * scaleOf(rule));

export function normalizeSubmission(game: Game, body: unknown): NormalizeResult {
  if (!isRecord(body)) return { ok: false, problems: ["body must be a JSON object"] };
  const problems: string[] = [];

  let submissionId = "";
  if (typeof body.submissionId === "string" && UUID_PATTERN.test(body.submissionId)) {
    submissionId = body.submissionId.toLowerCase();
  } else problems.push("submissionId must be a UUID");

  let client = "";
  if (typeof body.client === "string" && game.clients.includes(body.client)) client = body.client;
  else problems.push(`client must be one of ${game.clients.join(", ")}`);

  const initials = sanitizeInitials(body.initials, game.initials.default);

  const fields: FieldValues = {};
  const units: Record<string, bigint | null> = {};
  const rawUnits: Record<string, number | null> = {};

  for (const [name, rule] of Object.entries(game.fields)) {
    const raw = body[name];
    if (raw === undefined || raw === null) {
      if (rule.required) problems.push(`${name} is required`);
      rawUnits[name] = null;
      continue;
    }
    const reason = checkValue(name, raw, rule);
    if (reason) {
      if (rule.required || rule.onInvalid === "reject") problems.push(reason);
      rawUnits[name] = null;
      continue;
    }
    rawUnits[name] = toUnits(raw as number, rule);
  }

  for (const [name, rule] of Object.entries(game.fields)) {
    const u = rawUnits[name];
    if (u === null || u === undefined || typeof rule.max !== "object") continue;
    const refRule = game.fields[rule.max.field];
    const refUnits = rawUnits[rule.max.field];
    if (!refRule || refUnits === null || refUnits === undefined) continue;
    const refValue = refUnits / scaleOf(refRule);
    const maxUnits = Math.round(rule.max.factor * refValue * scaleOf(rule));
    if (u > maxUnits) {
      const reason = `${name} must be at most ${maxUnits / scaleOf(rule)}`;
      if (rule.required || rule.onInvalid === "reject") problems.push(reason);
      rawUnits[name] = null;
    }
  }

  for (const [name, rule] of Object.entries(game.fields)) {
    const u = rawUnits[name];
    if (u === null || u === undefined) {
      fields[name] = null;
      units[name] = null;
    } else {
      fields[name] = rule.precision === 0 ? u : u / scaleOf(rule);
      units[name] = BigInt(u);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { submissionId, client, initials, fields, units, canonical: JSON.stringify(fields) },
  };
}

function checkValue(name: string, raw: unknown, rule: FieldRule): string | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return `${name} must be a number`;
  if (rule.type === "integer" && !Number.isInteger(raw)) return `${name} must be an integer`;
  const u = toUnits(raw, rule);
  if (!Number.isSafeInteger(u)) return `${name} is out of range`;
  if (rule.step !== undefined && u % rule.step !== 0) return `${name} must be a multiple of ${rule.step}`;
  if (rule.min !== undefined && u < Math.round(rule.min * scaleOf(rule))) return `${name} must be at least ${rule.min}`;
  if (typeof rule.max === "number" && u > Math.round(rule.max * scaleOf(rule))) return `${name} must be at most ${rule.max}`;
  return null;
}
