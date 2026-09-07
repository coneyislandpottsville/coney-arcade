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

function submit(game: string, run: Record<string, unknown>): Promise<Response> {
  const request = new Request(`${BASE}/v1/games/${game}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": freshIp() },
    body: JSON.stringify({ submissionId: crypto.randomUUID(), client: game, initials: "PET", ...run }),
  });
  return app.fetch(request, env, createExecutionContext());
}

describe("the production registry", () => {
  it("requires a proof of play before storing a run for either game", async () => {
    for (const [game, run] of [
      ["slots", { win: 250 }],
      ["trivia", { points: 14, margin: 7, correct: 12 }],
      ["sharp-mountain", { time: 61.083, rawTime: 64.283, hotDogs: 22, burgers: 3, seed: 305419896 }],
    ] as const) {
      const refused = await submit(game, run);
      expect(refused.status).toBe(403);
      expect(await body(refused)).toEqual({ error: "proof required" });
      const board = await body<{ entries: unknown[] }>(await get(`/v1/games/${game}/board`));
      expect(board.entries).toHaveLength(0);
    }
  });

  it("lists the Trivia Bowl", async () => {
    const data = await body<{ games: Array<Record<string, unknown>> }>(await get("/v1/games"));
    expect(data.games.find((game) => game.id === "trivia")).toMatchObject({
      name: "Trivia Bowl",
      listed: true,
      board: 10,
      clients: ["trivia"],
      proof: "turnstile",
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

  it("lists Tiki Bar Slots", async () => {
    const data = await body<{ games: Array<Record<string, unknown>> }>(await get("/v1/games"));
    expect(data.games.find((game) => game.id === "slots")).toMatchObject({
      name: "Tiki Bar Slots",
      listed: true,
      board: 10,
      clients: ["slots"],
      proof: "turnstile",
      fields: { win: { type: "integer", required: true, min: 10, max: 250, step: 5, precision: 0, onInvalid: "reject" } },
      ranking: [{ field: "win", order: "desc", unknown: "last" }],
      columns: [{ field: "win", label: "Win", format: "integer" }],
    });
  });

  it("takes a Tiki Bar Slots win and refuses one the pay tables cannot produce", async () => {
    const ok = await validate("slots", { win: 250 });
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({ ok: true, normalized: { initials: "PET", win: 250 } });

    const refused: Array<[Record<string, unknown>, string]> = [
      [{ win: 5 }, "win must be at least 10"],
      [{ win: 255 }, "win must be at most 250"],
      [{ win: 62 }, "win must be a multiple of 5"],
      [{ win: 250.5 }, "win must be an integer"],
      [{}, "win is required"],
    ];
    for (const [run, problem] of refused) {
      const response = await validate("slots", run);
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ ok: false, problems: [problem] });
    }

    const spare = await validate("slots", { win: 10, streak: 3 });
    expect(spare.status).toBe(200);
    const { normalized } = await body<{ normalized: Record<string, unknown> }>(spare);
    expect(normalized).toEqual({ submissionId: expect.any(String), client: "slots", initials: "PET", win: 10 });
  });

  it("lists Sharp Mountain", async () => {
    const data = await body<{ games: Array<Record<string, unknown>> }>(await get("/v1/games"));
    expect(data.games.find((game) => game.id === "sharp-mountain")).toMatchObject({
      name: "Sharp Mountain",
      listed: true,
      board: 10,
      clients: ["sharp-mountain"],
      proof: "turnstile",
    });
  });

  it("takes a Sharp Mountain run and refuses a time the hill cannot produce", async () => {
    const ok = await validate("sharp-mountain", { time: 61.083, rawTime: 64.283, hotDogs: 22, burgers: 3, seed: 305419896 });
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({
      ok: true,
      normalized: { initials: "PET", time: 61.083, rawTime: 64.283, hotDogs: 22, burgers: 3, seed: 305419896 },
    });

    const refused: Array<[Record<string, unknown>, string]> = [
      [{ time: 19.5, rawTime: 26 }, "time must be at least 20"],
      [{ time: 241, rawTime: 241 }, "time must be at most 240"],
      [{ rawTime: 60 }, "time is required"],
    ];
    for (const [run, problem] of refused) {
      const response = await validate("sharp-mountain", run);
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ ok: false, problems: [problem] });
    }

    // More food than a hill holds is stored as unknown, not refused: the
    // ranked field is fine and the forensic one degrades.
    const spare = await validate("sharp-mountain", { time: 60, rawTime: 63, hotDogs: 41, burgers: 2, seed: 1 });
    expect(spare.status).toBe(200);
    expect(await body(spare)).toMatchObject({ ok: true, normalized: { time: 60, hotDogs: null, burgers: 2 } });
  });
});
