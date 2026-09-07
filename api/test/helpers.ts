import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createApp } from "../src/app.ts";
import type { Env } from "../src/env.ts";
import { SITEVERIFY_URL } from "../src/turnstile.ts";
import gate from "./fixtures/gate.json";
import maze from "./fixtures/maze.json";
import sprint from "./fixtures/sprint.json";

export type SiteverifyReply = { status?: number; body?: unknown } | "offline";

const replies: SiteverifyReply[] = [];

export const siteverify = {
  calls: [] as Array<Record<string, unknown>>,
  reply(...next: SiteverifyReply[]): void {
    replies.push(...next);
  },
  pending(): number {
    return replies.length;
  },
  reset(): void {
    replies.length = 0;
    siteverify.calls.length = 0;
  },
};

export function pass(over: Record<string, unknown> = {}): SiteverifyReply {
  return {
    body: {
      success: true,
      challenge_ts: "2026-09-07T12:00:00.000Z",
      hostname: "maze.coneyislandpottsville.com",
      action: "sign",
      "error-codes": [],
      ...over,
    },
  };
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== SITEVERIFY_URL) throw new Error(`unexpected fetch: ${url}`);
  siteverify.calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  const next = replies.shift();
  if (next === undefined) throw new Error("no siteverify reply scripted");
  if (next === "offline") throw new TypeError("network down");
  return new Response(JSON.stringify(next.body ?? {}), {
    status: next.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};

export const app = createApp([maze, sprint, gate], { fetch: fakeFetch });
export const BASE = "https://leaderboards.test";

let ipCounter = 1;
export function freshIp(): string {
  const n = ipCounter++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export type CallOptions = { ip?: string; base?: string; env?: Partial<Env> };

export function call(path: string, init: RequestInit = {}, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", options.ip ?? freshIp());
  const bindings = { ...env, ...options.env } as Env;
  return app.fetch(new Request((options.base ?? BASE) + path, { ...init, headers }), bindings, createExecutionContext());
}

export function post(
  path: string,
  body: unknown,
  options: CallOptions & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const { headers, ...rest } = options;
  return call(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    rest,
  );
}

export function run(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submissionId: crypto.randomUUID(),
    client: "maze2d",
    initials: "PET",
    score: 840,
    playTime: 33.2,
    levelReached: 4,
    ...over,
  };
}

export async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
