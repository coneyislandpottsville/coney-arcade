import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { body, call, freshIp, pass, post, run, siteverify } from "./helpers.ts";

type Entry = { rank: number; initials: string; client: string; submittedAt: string; [field: string]: unknown };
type Submitted = { duplicate: boolean; entry: Entry; board: Entry[] };

const SUBMIT = "/v1/games/maze/submissions";
const GATE = "/v1/games/gate/submissions";
const GATE_HOST = "gate.coneyislandpottsville.com";

function gateRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { submissionId: crypto.randomUUID(), client: "gate", initials: "ZED", laps: 3, ...over };
}

const proofOf = (submissionId: unknown, over: Record<string, unknown> = {}) =>
  pass({ hostname: GATE_HOST, cdata: String(submissionId), ...over });

async function gateBoard(): Promise<Entry[]> {
  return (await body<{ entries: Entry[] }>(await call("/v1/games/gate/board?limit=100"))).entries;
}

afterEach(() => {
  expect(siteverify.pending()).toBe(0);
  siteverify.reset();
});

describe("GET /v1/games", () => {
  it("lists the registry without origins", async () => {
    const response = await call("/v1/games");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const data = await body<{ games: Array<Record<string, unknown>> }>(response);
    expect(data.games.map((g) => g.id)).toEqual(["maze", "sprint", "gate"]);
    expect(data.games[0]).not.toHaveProperty("origins");
    expect(data.games[0]).not.toHaveProperty("proof");
    expect(data.games[0]).toMatchObject({ name: "The Maze of Time", listed: true, board: 10, clients: ["maze2d", "maze3d"] });
    expect(data.games[2]).toMatchObject({ id: "gate", proof: "turnstile" });
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
    expect((await post(SUBMIT, run({ note: "x".repeat(4200) }))).status).toBe(413);
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

describe("proof of play", () => {
  it("verifies a token with Cloudflare and stores the run", async () => {
    const submission = gateRun({ token: "tok-1" });
    siteverify.reply(proofOf(submission.submissionId));
    const response = await post(GATE, submission, { ip: "10.9.9.9" });
    expect(response.status).toBe(200);
    expect((await body<Submitted>(response)).entry).toMatchObject({ initials: "ZED", client: "gate", laps: 3 });
    expect(siteverify.calls).toEqual([{ secret: "test-secret", response: "tok-1", remoteip: "10.9.9.9" }]);
  });

  it("requires a token for a game that declares proof, and never for a duplicate", async () => {
    const bare = await post(GATE, gateRun());
    expect(bare.status).toBe(403);
    expect(await body(bare)).toEqual({ error: "proof required" });
    const submission = gateRun({ token: "tok-2" });
    siteverify.reply(proofOf(submission.submissionId));
    expect((await post(GATE, submission)).status).toBe(200);
    const { token: _token, ...again } = submission;
    const replay = await post(GATE, again);
    expect(replay.status).toBe(200);
    expect((await body<Submitted>(replay)).duplicate).toBe(true);
    expect(siteverify.calls).toHaveLength(1);
  });

  it("takes a run without a token from a game that has not declared proof, but verifies one it is given", async () => {
    expect((await post(SUBMIT, run())).status).toBe(200);
    const submission = run({ token: "tok-3" });
    siteverify.reply({ body: { success: false, "error-codes": ["invalid-input-response"] } });
    const bad = await post(SUBMIT, submission);
    expect(bad.status).toBe(403);
    expect(await body(bad)).toEqual({ error: "proof rejected", codes: ["invalid-input-response"] });
    siteverify.reply(pass({ cdata: String(submission.submissionId) }));
    expect((await post(SUBMIT, submission)).status).toBe(200);
    expect(siteverify.calls).toHaveLength(2);
  });

  it("refuses a token minted elsewhere, for another purpose, or for another run", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ hostname: "evil.example" }, "hostname-mismatch"],
      [{ hostname: `https://${GATE_HOST}` }, "hostname-mismatch"],
      [{ action: "login" }, "action-mismatch"],
      [{ action: undefined }, "action-mismatch"],
      [{ cdata: crypto.randomUUID() }, "cdata-mismatch"],
      [{ cdata: undefined }, "cdata-mismatch"],
    ];
    for (const [over, code] of cases) {
      const submission = gateRun({ initials: "BAD", token: "tok-4" });
      siteverify.reply(proofOf(submission.submissionId, over));
      const response = await post(GATE, submission);
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ error: "proof rejected", codes: [code] });
    }
    expect((await gateBoard()).filter((e) => e.initials === "BAD")).toHaveLength(0);
    const upper = gateRun({ initials: "UPP", token: "tok-4" });
    siteverify.reply(proofOf(String(upper.submissionId).toUpperCase()));
    expect((await post(GATE, upper)).status).toBe(200);
    expect((await gateBoard()).filter((e) => e.initials === "UPP")).toHaveLength(1);
  });

  it("relaxes the hostname, purpose and run checks only while the Worker itself runs on localhost", async () => {
    const testing = {
      body: { success: true, hostname: "example.com", "error-codes": [], metadata: { result_with_testing_key: true } },
    };
    siteverify.reply(testing);
    const local = await post(GATE, gateRun({ token: "XXXX.DUMMY.TOKEN.XXXX" }), { base: "http://localhost:8787" });
    expect(local.status).toBe(200);
    siteverify.reply(testing);
    const deployed = await post(GATE, gateRun({ token: "XXXX.DUMMY.TOKEN.XXXX" }));
    expect(deployed.status).toBe(403);
    expect(await body(deployed)).toEqual({ error: "proof rejected", codes: ["hostname-mismatch"] });
  });

  it("answers 503 when the secret is missing or Cloudflare cannot be reached, so the client keeps the run", async () => {
    const submission = gateRun({ initials: "SOS", token: "tok-5" });
    const unset = await post(GATE, submission, { env: { TURNSTILE_SECRET: undefined } });
    expect(unset.status).toBe(503);
    expect(siteverify.calls).toHaveLength(0);
    siteverify.reply("offline");
    expect((await post(GATE, submission)).status).toBe(503);
    siteverify.reply({ status: 502, body: {} });
    expect((await post(GATE, submission)).status).toBe(503);
    siteverify.reply({ body: "not an object" });
    expect((await post(GATE, submission)).status).toBe(503);
    expect((await gateBoard()).filter((e) => e.initials === "SOS")).toHaveLength(0);
  });

  it("turns away an empty or oversized token without asking Cloudflare", async () => {
    for (const token of ["", "x".repeat(2049)]) {
      const response = await post(GATE, gateRun({ token }));
      expect(response.status).toBe(403);
      expect(await body(response)).toEqual({ error: "proof rejected", codes: ["invalid-input-response"] });
    }
    expect(siteverify.calls).toHaveLength(0);
  });

  it("asks Cloudflare only for runs the rate limiter admits", async () => {
    const ip = freshIp();
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const submission = gateRun({ token: "tok-6" });
      siteverify.reply(proofOf(submission.submissionId));
      const response = await post(GATE, submission, { ip });
      if (response.status === 429) limited += 1;
      else expect(response.status).toBe(200);
    }
    expect(limited).toBeGreaterThan(0);
    expect(siteverify.pending()).toBe(limited);
    expect(siteverify.calls).toHaveLength(70 - limited);
    siteverify.reset();
  });

  it("checks a run on validate without a token and without asking Cloudflare", async () => {
    const plain = await post("/v1/games/gate/validate", { submissionId: crypto.randomUUID(), client: "gate", initials: "ZED", laps: 9 });
    expect(plain.status).toBe(200);
    const carried = await post("/v1/games/gate/validate", { submissionId: crypto.randomUUID(), client: "gate", initials: "ZED", laps: 9, token: "tok" });
    expect(carried.status).toBe(200);
    const { normalized } = await body<{ normalized: Record<string, unknown> }>(carried);
    expect(normalized).toMatchObject({ client: "gate", initials: "ZED", laps: 9 });
    expect(normalized).not.toHaveProperty("token");
    expect(siteverify.calls).toHaveLength(0);
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

  it("admits a localhost origin only while the Worker itself runs on localhost", async () => {
    const local = "http://localhost:4173";
    const dev = "http://localhost:8787";
    const preflight = await call(SUBMIT, { method: "OPTIONS", headers: { origin: local } }, { base: dev });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(local);
    const posted = await post(SUBMIT, run(), { headers: { origin: local }, base: dev });
    expect(posted.status).toBe(200);
    expect(posted.headers.get("access-control-allow-origin")).toBe(local);
    const deployed = await post(SUBMIT, run(), { headers: { origin: local } });
    expect(deployed.status).toBe(200);
    expect(deployed.headers.get("access-control-allow-origin")).toBeNull();
    const foreign = await call(SUBMIT, { method: "OPTIONS", headers: { origin: "https://evil.example" } }, { base: dev });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});
