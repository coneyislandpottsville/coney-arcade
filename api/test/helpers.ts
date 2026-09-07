import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createApp } from "../src/app.ts";
import maze from "./fixtures/maze.json";
import sprint from "./fixtures/sprint.json";

export const app = createApp([maze, sprint]);
export const BASE = "https://leaderboards.test";

let ipCounter = 1;
export function freshIp(): string {
  const n = ipCounter++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export function call(path: string, init: RequestInit = {}, ip: string = freshIp()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", ip);
  return app.fetch(new Request(BASE + path, { ...init, headers }), env, createExecutionContext());
}

export function post(
  path: string,
  body: unknown,
  options: { headers?: Record<string, string>; ip?: string } = {},
): Promise<Response> {
  return call(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    options.ip ?? freshIp(),
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
