import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { GAMES } from "../src/registry.ts";
import { body, freshIp } from "./helpers.ts";

const app = createApp(GAMES);
const BASE = "https://leaderboards.coneyislandpottsville.com";

function get(path: string): Promise<Response> {
  const request = new Request(BASE + path, { headers: { "cf-connecting-ip": freshIp() } });
  return app.fetch(request, env, createExecutionContext());
}

function validate(game: string, run: Record<string, unknown>): Promise<Response> {
  const request = new Request(`${BASE}/v1/games/${game}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": freshIp() },
    body: JSON.stringify({ submissionId: crypto.randomUUID(), client: game, initials: "PET", ...run }),
  });
  return app.fetch(request, env, createExecutionContext());
}

describe("the production registry", () => {
  it("lists the Trivia Bowl", async () => {
    const data = await body<{ games: Array<Record<string, unknown>> }>(await get("/v1/games"));
    expect(data.games.find((game) => game.id === "trivia")).toMatchObject({
      name: "Trivia Bowl",
      listed: true,
      board: 10,
      clients: ["trivia"],
    });
  });

  it("takes a Trivia Bowl winner's run and refuses a tie, a margin past the points, or an impossible score", async () => {
    const ok = await validate("trivia", { points: 14, margin: 7, correct: 12 });
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({ ok: true, normalized: { initials: "PET", points: 14, margin: 7, correct: 12 } });

    const refused: Array<[Record<string, unknown>, string]> = [
      [{ points: 7, margin: 0 }, "margin must be at least 1"],
      [{ points: 6, margin: 14 }, "margin must be at most 6"],
      [{ points: 15, margin: 1 }, "points must be at most 14"],
      [{ points: 5, margin: 5 }, "points must be at least 6"],
      [{ margin: 1 }, "points is required"],
    ];
    for (const [run, problem] of refused) {
      const response = await validate("trivia", run);
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ ok: false, problems: [problem] });
    }

    const spare = await validate("trivia", { points: 7, margin: 1, correct: 13 });
    expect(spare.status).toBe(200);
    expect(await body(spare)).toMatchObject({ ok: true, normalized: { points: 7, margin: 1, correct: null } });
  });
});
