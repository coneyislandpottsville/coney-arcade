import type { Bound, Column, FieldRule, Game, RankingComponent } from "./types.ts";
import { cleanInitials, isBlocked } from "./initials.ts";

export const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
export const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
export const ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+$|^http:\/\/localhost(:\d{1,5})?$/;
export const RESERVED_FIELDS = new Set(["initials", "client", "submissionId", "rank", "id", "submittedAt", "game", "token"]);

const LIMITS = { fields: 8, ranking: 4, columns: 4, clients: 8, origins: 8, board: 100, name: 60, label: 16, precision: 6 };

export type GameResult = { ok: true; game: Game } | { ok: false; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export function validateGame(input: unknown): GameResult {
  const problems: string[] = [];
  const bad = (message: string): void => {
    problems.push(message);
  };
  if (!isRecord(input)) return { ok: false, problems: ["a game must be a JSON object"] };

  const known = new Set(["$schema", "id", "name", "listed", "board", "clients", "origins", "initials", "fields", "ranking", "columns", "proof"]);
  for (const key of Object.keys(input)) if (!known.has(key)) bad(`unknown property "${key}"`);

  const id = isStr(input.id) && ID_PATTERN.test(input.id) ? input.id : (bad("id must match ^[a-z][a-z0-9-]{1,31}$"), "");
  const name =
    isStr(input.name) && input.name.length >= 1 && input.name.length <= LIMITS.name
      ? input.name
      : (bad(`name must be 1 to ${LIMITS.name} characters`), "");
  const listed = typeof input.listed === "boolean" ? input.listed : (bad("listed must be a boolean"), false);
  const board =
    isInt(input.board) && input.board >= 1 && input.board <= LIMITS.board
      ? input.board
      : (bad(`board must be an integer from 1 to ${LIMITS.board}`), 10);

  const clients = stringList(input.clients, "clients", 1, LIMITS.clients, ID_PATTERN, bad);
  const origins = stringList(input.origins, "origins", 0, LIMITS.origins, ORIGIN_PATTERN, bad);

  let defaultInitials = "";
  if (isRecord(input.initials) && isStr(input.initials.default) && /^[A-Z0-9]{1,3}$/.test(input.initials.default)) {
    defaultInitials = input.initials.default;
    if (cleanInitials(defaultInitials) !== defaultInitials || isBlocked(defaultInitials)) {
      bad("initials.default must be clean upper-case initials");
    }
    for (const key of Object.keys(input.initials)) if (key !== "default") bad(`unknown property "initials.${key}"`);
  } else {
    bad("initials.default must match ^[A-Z0-9]{1,3}$");
  }

  const fields: Record<string, FieldRule> = {};
  if (isRecord(input.fields)) {
    const names = Object.keys(input.fields);
    if (names.length < 1 || names.length > LIMITS.fields) bad(`fields must declare 1 to ${LIMITS.fields} fields`);
    for (const fieldName of names) {
      if (!FIELD_NAME_PATTERN.test(fieldName)) bad(`field "${fieldName}" must match ^[a-z][A-Za-z0-9]{0,31}$`);
      if (RESERVED_FIELDS.has(fieldName)) bad(`field "${fieldName}" is a reserved name`);
      const rule = validateField(fieldName, input.fields[fieldName], bad);
      if (rule) fields[fieldName] = rule;
    }
    for (const [fieldName, rule] of Object.entries(fields)) {
      if (typeof rule.max === "object") {
        const ref = fields[rule.max.field];
        if (!ref) bad(`field "${fieldName}" max refers to an undeclared field "${rule.max.field}"`);
        else if (rule.max.field === fieldName) bad(`field "${fieldName}" max cannot refer to itself`);
        else if (!ref.required) bad(`field "${fieldName}" max refers to "${rule.max.field}", which must be required`);
        else if (typeof ref.max === "object") bad(`field "${fieldName}" max refers to "${rule.max.field}", which must have a fixed max`);
      }
      if (rule.min !== undefined && typeof rule.max === "number" && rule.min > rule.max) {
        bad(`field "${fieldName}" min exceeds max`);
      }
    }
  } else {
    bad("fields must be an object");
  }

  const ranking = validateRanking(input.ranking, fields, bad);
  const columns = validateColumns(input.columns, fields, bad);

  let proof: Game["proof"];
  if (input.proof !== undefined) {
    if (input.proof === "turnstile") proof = "turnstile";
    else bad('proof must be "turnstile"');
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    game: {
      id, name, listed, board, clients, origins, initials: { default: defaultInitials }, fields, ranking, columns,
      ...(proof ? { proof } : {}),
    },
  };
}

function stringList(
  value: unknown,
  label: string,
  min: number,
  max: number,
  pattern: RegExp,
  bad: (message: string) => void,
): string[] {
  if (!Array.isArray(value)) {
    bad(`${label} must be an array`);
    return [];
  }
  if (value.length < min || value.length > max) bad(`${label} must have ${min} to ${max} items`);
  const out: string[] = [];
  for (const item of value) {
    if (!isStr(item) || !pattern.test(item)) bad(`${label} item ${JSON.stringify(item)} is not allowed`);
    else if (out.includes(item)) bad(`${label} repeats "${item}"`);
    else out.push(item);
  }
  return out;
}

function validateField(fieldName: string, value: unknown, bad: (message: string) => void): FieldRule | null {
  if (!isRecord(value)) {
    bad(`field "${fieldName}" must be an object`);
    return null;
  }
  const known = new Set(["type", "required", "min", "max", "step", "precision", "onInvalid"]);
  for (const key of Object.keys(value)) if (!known.has(key)) bad(`field "${fieldName}" has an unknown property "${key}"`);
  const type = value.type;
  if (type !== "integer" && type !== "decimal") {
    bad(`field "${fieldName}" type must be "integer" or "decimal"`);
    return null;
  }
  const required = value.required === undefined ? false : value.required;
  if (typeof required !== "boolean") bad(`field "${fieldName}" required must be a boolean`);
  const onInvalid = value.onInvalid === undefined ? "reject" : value.onInvalid;
  if (onInvalid !== "unknown" && onInvalid !== "reject") bad(`field "${fieldName}" onInvalid must be "unknown" or "reject"`);
  if (value.min !== undefined && !isNum(value.min)) bad(`field "${fieldName}" min must be a number`);
  let max: Bound | undefined;
  if (value.max !== undefined) {
    if (isNum(value.max)) max = value.max;
    else if (isRecord(value.max) && isStr(value.max.field) && isNum(value.max.factor) && value.max.factor > 0) {
      for (const key of Object.keys(value.max)) if (key !== "field" && key !== "factor") bad(`field "${fieldName}" max has an unknown property "${key}"`);
      max = { field: value.max.field, factor: value.max.factor };
    } else bad(`field "${fieldName}" max must be a number or {field, factor}`);
  }
  if (value.step !== undefined) {
    if (type !== "integer") bad(`field "${fieldName}" step is only for integers`);
    else if (!isInt(value.step) || value.step < 1) bad(`field "${fieldName}" step must be a positive integer`);
  }
  let precision = 0;
  if (type === "decimal") {
    if (!isInt(value.precision) || value.precision < 0 || value.precision > LIMITS.precision) {
      bad(`field "${fieldName}" precision must be an integer from 0 to ${LIMITS.precision}`);
    } else precision = value.precision;
  } else if (value.precision !== undefined) {
    bad(`field "${fieldName}" precision is only for decimals`);
  }
  const rule: FieldRule = {
    type,
    required: required === true,
    precision,
    onInvalid: onInvalid === "unknown" ? "unknown" : "reject",
  };
  if (isNum(value.min)) rule.min = value.min;
  if (max !== undefined) rule.max = max;
  if (type === "integer" && isInt(value.step) && value.step >= 1) rule.step = value.step;
  return rule;
}

function validateRanking(
  value: unknown,
  fields: Record<string, FieldRule>,
  bad: (message: string) => void,
): RankingComponent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.ranking) {
    bad(`ranking must list 1 to ${LIMITS.ranking} components`);
    return [];
  }
  const out: RankingComponent[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isStr(item.field) || (item.order !== "asc" && item.order !== "desc")) {
      bad("each ranking component needs a field and an order of asc or desc");
      continue;
    }
    for (const key of Object.keys(item)) if (!["field", "order", "unknown"].includes(key)) bad(`ranking has an unknown property "${key}"`);
    const unknown = item.unknown === undefined ? "last" : item.unknown;
    if (unknown !== "first" && unknown !== "last") bad(`ranking on "${item.field}" unknown must be "first" or "last"`);
    if (!fields[item.field]) bad(`ranking refers to an undeclared field "${item.field}"`);
    if (out.some((c) => c.field === item.field)) bad(`ranking repeats "${item.field}"`);
    out.push({ field: item.field, order: item.order, unknown: unknown === "first" ? "first" : "last" });
  }
  return out;
}

function validateColumns(value: unknown, fields: Record<string, FieldRule>, bad: (message: string) => void): Column[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.columns) {
    bad(`columns must list 1 to ${LIMITS.columns} columns`);
    return [];
  }
  const out: Column[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isStr(item.field) || !isStr(item.label)) {
      bad("each column needs a field and a label");
      continue;
    }
    for (const key of Object.keys(item)) if (!["field", "label", "format"].includes(key)) bad(`column has an unknown property "${key}"`);
    if (item.label.length < 1 || item.label.length > LIMITS.label) bad(`column label "${item.label}" must be 1 to ${LIMITS.label} characters`);
    const format = item.format === undefined ? "integer" : item.format;
    if (format !== "integer" && format !== "decimal" && format !== "duration") bad(`column "${item.field}" format is not allowed`);
    if (!fields[item.field]) bad(`column refers to an undeclared field "${item.field}"`);
    out.push({ field: item.field, label: item.label, format: format === "decimal" || format === "duration" ? format : "integer" });
  }
  return out;
}

export function buildRegistry(inputs: unknown[]): Map<string, Game> {
  const registry = new Map<string, Game>();
  const problems: string[] = [];
  inputs.forEach((input, index) => {
    const result = validateGame(input);
    if (!result.ok) {
      problems.push(...result.problems.map((p) => `game ${index}: ${p}`));
      return;
    }
    if (registry.has(result.game.id)) problems.push(`game ${index}: duplicate id "${result.game.id}"`);
    else registry.set(result.game.id, result.game);
  });
  if (problems.length > 0) throw new Error(`invalid registry:\n${problems.join("\n")}`);
  return registry;
}
