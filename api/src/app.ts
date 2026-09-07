import { board, boardStatement, findSubmission, insertEntry, rankOf, toEntry, type EntryRow, type StoredSubmission } from "./board.ts";
import { allowedOrigin, corsHeaders, isLocal, preflight } from "./cors.ts";
import type { Env, Limiter } from "./env.ts";
import { encodeRankKey } from "./rank.ts";
import { buildRegistry } from "./rules.ts";
import { MAX_TOKEN_LENGTH, PROOF_ACTION, verifyProof } from "./turnstile.ts";
import type { Entry, Game } from "./types.ts";
import { normalizeSubmission, type Normalized } from "./validate.ts";

const MAX_BODY_BYTES = 4096;
const MAX_BOARD_LIMIT = 100;
const MAX_COMBINED_LIMIT = 25;
const DEFAULT_COMBINED_LIMIT = 5;
const GET_METHODS = "GET, OPTIONS";
const POST_METHODS = "POST, OPTIONS";

type Handler = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };

export type AppOptions = { fetch?: typeof fetch };

export function createApp(games: unknown[], options: AppOptions = {}): Handler {
  const registry = buildRegistry(games);
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        return await route(registry, request, env, fetchImpl);
      } catch (error) {
        console.error("leaderboards request failed:", error);
        return json({ error: "unavailable" }, 500);
      }
    },
  };
}

async function route(registry: Map<string, Game>, request: Request, env: Env, fetchImpl: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/v1/games") {
    if (method === "OPTIONS") return preflight("*", GET_METHODS);
    if (method !== "GET") return methodNotAllowed(GET_METHODS);
    return cached(json({ games: [...registry.values()].map(publicGame) }), "*");
  }

  if (path === "/v1/board") {
    if (method === "OPTIONS") return preflight("*", GET_METHODS);
    if (method !== "GET") return methodNotAllowed(GET_METHODS);
    return cached(await combinedBoard(registry, env.DB, parseLimit(url, DEFAULT_COMBINED_LIMIT, MAX_COMBINED_LIMIT)), "*");
  }

  const match = /^\/v1\/games\/([a-z][a-z0-9-]{1,31})\/(board|submissions|validate)$/.exec(path);
  if (!match) return json({ error: "not found" }, 404);
  const game = registry.get(match[1]!);
  if (!game) return json({ error: "unknown game" }, 404);
  const resource = match[2]!;

  if (resource === "board") {
    if (method === "OPTIONS") return preflight("*", GET_METHODS);
    if (method !== "GET") return methodNotAllowed(GET_METHODS);
    const entries = await board(env.DB, game.id, parseLimit(url, game.board, MAX_BOARD_LIMIT));
    return cached(json({ game: boardHeader(game), entries }), "*");
  }

  const origin = allowedOrigin(game, request);
  if (method === "OPTIONS") return preflight(origin, POST_METHODS);
  if (method !== "POST") return methodNotAllowed(POST_METHODS);

  const body = await readJson(request);
  if (!body.ok) return withCors(body.response, origin);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  if (resource === "validate") {
    if (!(await allow(env.VALIDATE_LIMITER, `val:${game.id}:${await hash(ip)}`))) return withCors(rateLimited(), origin);
    const normalized = normalizeSubmission(game, body.value);
    if (!normalized.ok) return withCors(json({ ok: false, problems: normalized.problems }, 400), origin);
    return withCors(json({ ok: true, normalized: publicNormalized(normalized.value) }), origin);
  }

  const normalized = normalizeSubmission(game, body.value);
  if (!normalized.ok) return withCors(json({ error: "invalid submission", problems: normalized.problems }, 400), origin);
  const value = normalized.value;

  const existing = await findSubmission(env.DB, game.id, value.submissionId);
  if (existing) return withCors(await answerExisting(env.DB, game, value, existing), origin);

  if (!(await allow(env.SUBMIT_LIMITER, `sub:${game.id}:${await hash(ip)}`))) return withCors(rateLimited(), origin);

  const refused = await checkProof(game, body.value, value.submissionId, request, env, fetchImpl, ip);
  if (refused) return withCors(refused, origin);

  const rankKey = encodeRankKey(game, value.units);
  const inserted = await insertEntry(env.DB, {
    gameId: game.id,
    submissionId: value.submissionId,
    client: value.client,
    initials: value.initials,
    canonical: value.canonical,
    rankKey,
  });
  if (!inserted) {
    const raced = await findSubmission(env.DB, game.id, value.submissionId);
    if (!raced) throw new Error("insert vanished");
    return withCors(await answerExisting(env.DB, game, value, raced), origin);
  }

  const row: EntryRow = { id: inserted.id, initials: value.initials, client: value.client, fields: value.canonical, created_at: inserted.created_at };
  return withCors(await answer(env.DB, game, row, rankKey, false), origin);
}

async function checkProof(
  game: Game,
  body: unknown,
  submissionId: string,
  request: Request,
  env: Env,
  fetchImpl: typeof fetch,
  ip: string,
): Promise<Response | null> {
  const token = isRecord(body) && typeof body.token === "string" ? body.token : null;
  if (token === null) return game.proof === "turnstile" ? json({ error: "proof required" }, 403) : null;
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return proofRejected(["invalid-input-response"]);
  if (!env.TURNSTILE_SECRET) {
    console.error("TURNSTILE_SECRET is not set; a proof arrived that cannot be verified");
    return json({ error: "unavailable" }, 503);
  }
  const proof = await verifyProof(fetchImpl, env.TURNSTILE_SECRET, token, ip);
  if (proof.ok === null) return json({ error: "unavailable" }, 503);
  if (!proof.ok) return proofRejected(proof.codes);
  if (isLocal(request)) return null;
  const hostnames = game.origins.map((origin) => new URL(origin).hostname);
  if (!hostnames.includes(proof.hostname)) return proofRejected(["hostname-mismatch"]);
  if (proof.action !== PROOF_ACTION) return proofRejected(["action-mismatch"]);
  if (proof.cdata?.toLowerCase() !== submissionId) return proofRejected(["cdata-mismatch"]);
  return null;
}

function proofRejected(codes: string[]): Response {
  return json({ error: "proof rejected", codes }, 403);
}

async function answerExisting(db: D1Database, game: Game, value: Normalized, existing: StoredSubmission): Promise<Response> {
  const same = existing.client === value.client && existing.initials === value.initials && existing.fields === value.canonical;
  if (!same) return json({ error: "conflict" }, 409);
  return answer(db, game, existing, existing.rank_key, true);
}

async function answer(db: D1Database, game: Game, row: EntryRow, rankKey: string, duplicate: boolean): Promise<Response> {
  const [rank, entries] = await Promise.all([rankOf(db, game.id, rankKey, row.id), board(db, game.id, game.board)]);
  return json({ duplicate, entry: toEntry(row, rank), board: entries });
}

async function combinedBoard(registry: Map<string, Game>, db: D1Database, limit: number): Promise<Response> {
  const listed = [...registry.values()].filter((game) => game.listed);
  if (listed.length === 0) return json({ games: [] });
  const results = await db.batch<EntryRow>(listed.map((game) => boardStatement(db, game.id, limit)));
  const games = listed.map((game, index) => ({
    ...boardHeader(game),
    entries: (results[index]?.results ?? []).map((row, i) => toEntry(row, i + 1)),
  }));
  return json({ games });
}

function boardHeader(game: Game): { id: string; name: string; columns: Game["columns"] } {
  return { id: game.id, name: game.name, columns: game.columns };
}

function publicGame(game: Game): Omit<Game, "origins"> {
  const { origins: _origins, ...rest } = game;
  return rest;
}

function publicNormalized(value: Normalized): Record<string, unknown> {
  return { submissionId: value.submissionId, client: value.client, initials: value.initials, ...value.fields };
}

type Body = { ok: true; value: unknown } | { ok: false; response: Response };

async function readJson(request: Request): Promise<Body> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: json({ error: "unsupported media type" }, 415) };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: "payload too large" }, 413) };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: "payload too large" }, 413) };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: json({ error: "malformed json" }, 400) };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

async function allow(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseLimit(url: URL, fallback: number, max: number): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function cached(response: Response, origin: string): Response {
  response.headers.set("cache-control", "public, max-age=10");
  return withCors(response, origin);
}

function withCors(response: Response, origin: string | null): Response {
  for (const [name, value] of Object.entries(corsHeaders(origin, origin === "*" ? GET_METHODS : POST_METHODS))) {
    if (name === "access-control-allow-origin" || name === "vary") response.headers.set(name, value);
  }
  return response;
}

function methodNotAllowed(allow: string): Response {
  const response = json({ error: "method not allowed" }, 405);
  response.headers.set("allow", allow);
  return response;
}

function rateLimited(): Response {
  const response = json({ error: "rate limited" }, 429);
  response.headers.set("retry-after", "60");
  return response;
}

export type { Entry };
