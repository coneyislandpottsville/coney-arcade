import type { Game } from "./types.ts";

export function allowedOrigin(game: Game, request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin !== null && game.origins.includes(origin) ? origin : null;
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
