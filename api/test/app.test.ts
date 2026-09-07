import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { body, call, freshIp, post, run } from "./helpers.ts";

type Entry = { rank: number; initials: string; client: string; submittedAt: string; [field: string]: unknown };
type Submitted = { duplicate: boolean; entry: Entry; board: Entry[] };

const SUBMIT = "/v1/games/maze/submissions";

describe("GET /v1/games", () => {
  it("lists the registry without origins", async () => {
    const response = await call("/v1/games");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const data = await body<{ games: Array<Record<string, unknown>> }>(response);
    expect(data.games.map((g) => g.id)).toEqual(["maze", "sprint"]);
    expect(data.games[0]).not.toHaveProperty("origins");
    expect(data.games[0]).toMatchObject({ name: "The Maze of Time", listed: true, board: 10, clients: ["maze2d", "maze3d"] });
  });
});

describe("POST /v1/games/{game}/submissions", () => {
  it("stores a run and answers with its rank and the board", async () => {
    const first = run({ score: 840, playTime: 33.2 });
    const response = await post(SUBMIT, first);
    expect(response.status).toBe(200);
    const data = await body<Submitted>(response);
    expect(data.duplicate).toBe(false);
    expect(data.entry).toMatchObject({ rank: 1, initials: "PET", client: "maze2d", score: 840, playTime: 33.2, levelReached: 4 });
    expect(data.entry.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.board).toHaveLength(1);

    const better = await body<Submitted>(await post(SUBMIT, run({ score: 1200, initials: "ACE" })));
    expect(better.entry.rank).toBe(1);
    expect(better.board.map((e) => [e.rank, e.initials])).toEqual([[1, "ACE"], [2, "PET"]]);
  });

  it("answers a repeated submission from the stored row without a new entry", async () => {
    const submission = run({ score: 500 });
    const first = await body<Submitted>(await post(SUBMIT, submission));
    const again = await post(SUBMIT, { ...submission, submissionId: String(submission.submissionId).toUpperCase() });
    expect(again.status).toBe(200);
    const data = await body<Submitted>(again);
    expect(data.duplicate).toBe(true);
    expect(data.entry.rank).toBe(first.entry.rank);
    expect(data.board).toHaveLength(first.board.length);
  });

  it("refuses a reused id that carries different run data", async () => {
    const submission = run({ score: 500 });
    await post(SUBMIT, submission);
    const conflict = await post(SUBMIT, { ...submission, score: 510 });
    expect(conflict.status).toBe(409);
    expect(await body(conflict)).toEqual({ error: "conflict" });
    const initials = await post(SUBMIT, { ...submission, initials: "ZZZ" });
    expect(initials.status).toBe(409);
    const boardNow = await body<{ entries: Entry[] }>(await call("/v1/games/maze/board?limit=100"));
    expect(boardNow.entries.filter((e) => e.score === 510)).toHaveLength(0);
  });

  it("rejects an invalid run with every problem", async () => {
    const response = await post(SUBMIT, run({ score: 845, levelReached: 0 }));
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: "invalid submission",
      problems: ["score must be a multiple of 10", "levelReached must be at least 1"],
    });
  });

  it("refuses the wrong shapes of request", async () => {
    expect((await post("/v1/games/nope/submissions", run())).status).toBe(404);
    expect((await call("/v1/games/maze/submissions", { method: "GET" })).status).toBe(405);
    expect((await call(SUBMIT, { method: "POST", body: JSON.stringify(run()) })).status).toBe(415);
    expect((await call(SUBMIT, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(run()) })).status).toBe(415);
    expect((await post(SUBMIT, "{not json")).status).toBe(400);
    expect((await post(SUBMIT, run({ note: "x".repeat(2100) }))).status).toBe(413);
    expect((await call("/")).status).toBe(404);
    expect((await call("/v1/games/maze/nothing")).status).toBe(404);
  });

  it("orders the board by score, then time with unknown last, then arrival", async () => {
    const ip = freshIp();
    const rows: Array<[string, number, number | undefined]> = [
      ["SLO", 700, 30],
      ["NEW", 700, undefined],
      ["OLD", 700, undefined],
      ["FAS", 700, 12],
      ["TOP", 710, 100],
    ];
    for (const [initials, score, playTime] of rows) {
      const response = await post(SUBMIT, run({ initials, score, playTime }), { ip });
      expect(response.status).toBe(200);
    }
    const board = await body<{ entries: Entry[] }>(await call("/v1/games/maze/board?limit=100"));
    const relevant = board.entries.filter((e) => e.score === 700 || e.score === 710);
    expect(relevant.map((e) => e.initials)).toEqual(["TOP", "FAS", "SLO", "NEW", "OLD"]);
    expect(relevant.map((e) => e.playTime)).toEqual([100, 12, 30, null, null]);
  });

  it("ranks beyond the served board", async () => {
    const ip = freshIp();
    for (let i = 0; i < 11; i++) {
      expect((await post(SUBMIT, run({ score: 2000 + i * 10 }), { ip })).status).toBe(200);
    }
    const low = await body<Submitted>(await post(SUBMIT, run({ score: 20 }), { ip }));
    expect(low.entry.rank).toBeGreaterThan(10);
    expect(low.board).toHaveLength(10);
    expect(low.board.some((e) => e.score === 20)).toBe(false);
  });

  it("rate limits a flood of new submissions but never a duplicate", async () => {
    expect(env.SUBMIT_LIMITER).toBeDefined();
    const ip = freshIp();
    const first = run({ score: 300 });
    expect((await post(SUBMIT, first, { ip })).status).toBe(200);
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const response = await post(SUBMIT, run({ score: 300 }), { ip });
      if (response.status === 429) {
        limited += 1;
        expect(response.headers.get("retry-after")).toBe("60");
      } else expect(response.status).toBe(200);
    }
    expect(limited).toBeGreaterThan(0);
    const again = await post(SUBMIT, first, { ip });
    expect(again.status).toBe(200);
    expect((await body<Submitted>(again)).duplicate).toBe(true);
  });
});

describe("POST /v1/games/{game}/validate", () => {
  it("checks a run without storing it", async () => {
    const before = await body<{ entries: Entry[] }>(await call("/v1/games/sprint/board"));
    const ok = await post("/v1/games/sprint/validate", { submissionId: run().submissionId, client: "sprint", initials: "zed", time: 12.345 });
    expect(ok.status).toBe(200);
    expect(await body(ok)).toMatchObject({ ok: true, normalized: { client: "sprint", initials: "ZED", time: 12.35, laps: null } });
    const bad = await post("/v1/games/sprint/validate", { submissionId: "x", client: "sprint", time: -1 });
    expect(bad.status).toBe(400);
    expect(await body(bad)).toEqual({ ok: false, problems: ["submissionId must be a UUID", "time must be at least 0.01"] });
    const after = await body<{ entries: Entry[] }>(await call("/v1/games/sprint/board"));
    expect(after.entries).toHaveLength(before.entries.length);
  });
});

describe("boards", () => {
  it("serves one board with its header and honours the limit", async () => {
    const ip = freshIp();
    for (const [initials, time, laps] of [["AAA", 60, 2], ["BBB", 50, 3], ["CCC", 55, 3], ["DDD", 10, undefined]] as const) {
      const response = await post("/v1/games/sprint/submissions", { submissionId: crypto.randomUUID(), client: "sprint", initials, time, laps }, { ip });
      expect(response.status).toBe(200);
    }
    const response = await call("/v1/games/sprint/board");
    expect(response.headers.get("cache-control")).toBe("public, max-age=10");
    const data = await body<{ game: Record<string, unknown>; entries: Entry[] }>(response);
    expect(data.game).toEqual({
      id: "sprint",
      name: "Sprint",
      columns: [{ field: "time", label: "Time", format: "decimal" }, { field: "laps", label: "Laps", format: "integer" }],
    });
    expect(data.entries.map((e) => e.initials)).toEqual(["DDD", "BBB", "CCC"]);
    const two = await body<{ entries: Entry[] }>(await call("/v1/games/sprint/board?limit=2"));
    expect(two.entries).toHaveLength(2);
    const wide = await body<{ entries: Entry[] }>(await call("/v1/games/sprint/board?limit=1000"));
    expect(wide.entries).toHaveLength(4);
  });

  it("serves every listed game in one call", async () => {
    await post(SUBMIT, run({ score: 990 }));
    const data = await body<{ games: Array<{ id: string; entries: Entry[] }> }>(await call("/v1/board"));
    expect(data.games.map((g) => g.id)).toEqual(["maze"]);
    expect(data.games[0]!.entries.length).toBeLessThanOrEqual(5);
    expect(data.games[0]!.entries[0]!.rank).toBe(1);
    const one = await body<{ games: Array<{ entries: Entry[] }> }>(await call("/v1/board?limit=1"));
    expect(one.games[0]!.entries).toHaveLength(1);
  });
});

describe("CORS", () => {
  const origin = "https://maze.coneyislandpottsville.com";

  it("answers a preflight for a registered origin only", async () => {
    const allowed = await call(SUBMIT, { method: "OPTIONS", headers: { origin } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(allowed.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(allowed.headers.get("vary")).toBe("origin");
    const denied = await call(SUBMIT, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(denied.status).toBe(204);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes a registered origin on a submission and stays open on reads", async () => {
    const response = await post(SUBMIT, run(), { headers: { origin } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    const foreign = await post(SUBMIT, run(), { headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(200);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    const board = await call("/v1/games/maze/board", { headers: { origin: "https://anywhere.example" } });
    expect(board.headers.get("access-control-allow-origin")).toBe("*");
  });
});
