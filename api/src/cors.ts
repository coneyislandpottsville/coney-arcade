import type { Game } from "./types.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;

export function allowedOrigin(game: Game, request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  if (game.origins.includes(origin)) return origin;
  return LOCAL_ORIGIN.test(origin) && LOCAL_HOSTS.has(new URL(request.url).hostname) ? origin : null;
}

export function corsHeaders(origin: string | null, methods: string): Record<string, string> {
  if (origin === null) return {};
  const headers: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
  if (origin !== "*") headers.vary = "origin";
  return headers;
}

export function preflight(origin: string | null, methods: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin, methods) });
}
