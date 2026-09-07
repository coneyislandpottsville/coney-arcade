import { describe, expect, it } from "vitest";
import { createLeaderboards, fetchBoards, formatValue, type Options, type StorageLike } from "../client/leaderboards.ts";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

type Call = { url: string; body: Record<string, unknown> | null };

function fakeFetch(script: Array<{ status: number; body?: unknown } | "offline">) {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    const raw = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: String(input), body: raw });
    const step = script.shift();
    if (step === undefined) throw new Error("no scripted response left");
    if (step === "offline") throw new TypeError("network down");
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
  };
  return { impl, calls };
}

const accepted = (rank: number) => ({
  status: 200,
  body: { duplicate: false, entry: { rank, initials: "PET", client: "maze2d", submittedAt: "2026-09-06T00:00:00.000Z", score: 840 }, board: [] },
});

const ID = "9b2e6c1a-6a1f-4e3b-9d3c-1d2f3a4b5c6d";

function options(fetchImpl: typeof fetch, storage: StorageLike, clock: { now: number }): Options {
  return {
    game: "maze",
    client: "maze2d",
    baseUrl: "https://leaderboards.test/",
    storage,
    fetch: fetchImpl,
    now: () => clock.now,
    uuid: () => ID,
  };
}

function client(fetchImpl: typeof fetch, storage: StorageLike, clock: { now: number }) {
  return createLeaderboards(options(fetchImpl, storage, clock));
}

describe("createLeaderboards", () => {
  it("posts the run with an id and the client label, then clears the outbox", async () => {
    const storage = memoryStorage();
    const { impl, calls } = fakeFetch([accepted(3)]);
    const boards = client(impl, storage, { now: 1000 });
    const result = await boards.submit({ initials: "PET", score: 840, playTime: 33.2 });
    expect(result).toMatchObject({ status: "accepted", duplicate: false, rank: 3 });
    expect(calls[0]!.url).toBe("https://leaderboards.test/v1/games/maze/submissions");
    expect(calls[0]!.body).toEqual({
      initials: "PET",
      score: 840,
      playTime: 33.2,
      submissionId: ID,
      client: "maze2d",
    });
    expect(boards.pending()).toBe(0);
    expect(storage.data.size).toBe(0);
  });

  it("keeps a run that could not be posted and retries it on flush with the same id", async () => {
    const storage = memoryStorage();
    const clock = { now: 1000 };
    const { impl, calls } = fakeFetch(["offline", { status: 503, body: { error: "unavailable" } }, { status: 429, body: {} }, accepted(1)]);
    const boards = client(impl, storage, clock);

    expect(await boards.submit({ initials: "PET", score: 840 })).toEqual({ status: "pending", attempts: 1 });
    expect(boards.pending()).toBe(1);

    expect(await boards.flush()).toEqual([]);
    clock.now += 5_000;
    expect(await boards.flush()).toEqual([{ status: "pending", attempts: 2 }]);
    clock.now += 30_000;
    expect(await boards.flush()).toEqual([{ status: "pending", attempts: 3 }]);
    clock.now += 120_000;
    const results = await boards.flush();
    expect(results[0]).toMatchObject({ status: "accepted", rank: 1 });
    expect(boards.pending()).toBe(0);
    expect(new Set(calls.map((c) => c.body?.submissionId)).size).toBe(1);
  });

  it("drops a rejected or conflicting run instead of retrying it", async () => {
    const storage = memoryStorage();
    const { impl } = fakeFetch([{ status: 400, body: { error: "invalid submission", problems: ["score is required"] } }, { status: 409, body: { error: "conflict" } }]);
    const boards = client(impl, storage, { now: 0 });
    expect(await boards.submit({ initials: "PET" })).toEqual({ status: "rejected", problems: ["score is required"] });
    expect(await boards.submit({ initials: "PET", score: 10 })).toEqual({ status: "conflict" });
    expect(boards.pending()).toBe(0);
  });

  it("treats a duplicate answer as accepted", async () => {
    const storage = memoryStorage();
    const { impl } = fakeFetch([{ ...accepted(2), body: { ...accepted(2).body, duplicate: true } }]);
    const boards = client(impl, storage, { now: 0 });
    expect(await boards.submit({ initials: "PET", score: 840 })).toMatchObject({ status: "accepted", duplicate: true, rank: 2 });
  });

  it("survives a reload by reading the outbox back from storage", async () => {
    const storage = memoryStorage();
    const first = client(fakeFetch(["offline"]).impl, storage, { now: 0 });
    await first.submit({ initials: "PET", score: 840 });
    const later = client(fakeFetch([accepted(1)]).impl, storage, { now: 10_000 });
    expect(later.pending()).toBe(1);
    expect((await later.flush())[0]).toMatchObject({ status: "accepted" });
    expect(later.pending()).toBe(0);
  });

  it("caps the outbox", async () => {
    const storage = memoryStorage();
    const { impl } = fakeFetch(Array.from({ length: 25 }, () => "offline" as const));
    const boards = createLeaderboards({ game: "maze", client: "maze2d", storage, fetch: impl, now: () => 0 });
    for (let i = 0; i < 25; i++) await boards.submit({ initials: "PET", score: 10 + i * 10 });
    expect(boards.pending()).toBe(20);
  });

  it("asks the proof provider before every attempt and sends what it gives", async () => {
    const storage = memoryStorage();
    const clock = { now: 1000 };
    const { impl, calls } = fakeFetch([
      "offline",
      { status: 403, body: { error: "proof rejected", codes: ["timeout-or-duplicate"] } },
      accepted(1),
    ]);
    const asked: string[] = [];
    const tokens = ["tok-1", "tok-2", "tok-3"];
    const boards = createLeaderboards({
      ...options(impl, storage, clock),
      token: async (submissionId) => {
        asked.push(submissionId);
        return tokens.shift() ?? null;
      },
    });
    expect(await boards.submit({ initials: "PET", score: 840 })).toEqual({ status: "pending", attempts: 1 });
    clock.now += 5_000;
    expect(await boards.flush()).toEqual([{ status: "pending", attempts: 2 }]);
    expect(boards.pending()).toBe(1);
    clock.now += 30_000;
    expect((await boards.flush())[0]).toMatchObject({ status: "accepted", rank: 1 });
    expect(asked).toEqual([ID, ID, ID]);
    expect(calls.map((c) => c.body?.token)).toEqual(["tok-1", "tok-2", "tok-3"]);
    expect(boards.pending()).toBe(0);
  });

  it("posts without a token when there is no provider, or when the provider has nothing or fails", async () => {
    const storage = memoryStorage();
    const clock = { now: 0 };
    const { impl, calls } = fakeFetch([accepted(1), accepted(1), accepted(1)]);
    const base = options(impl, storage, clock);
    await createLeaderboards(base).submit({ initials: "PET", score: 840 });
    await createLeaderboards({ ...base, token: async () => null }).submit({ initials: "PET", score: 850 });
    await createLeaderboards({
      ...base,
      token: async () => {
        throw new Error("no widget");
      },
    }).submit({ initials: "PET", score: 860 });
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.body).not.toHaveProperty("token");
  });

  it("reads a board and validates a run", async () => {
    const storage = memoryStorage();
    const { impl, calls } = fakeFetch([
      { status: 200, body: { game: { id: "maze", name: "The Maze of Time", columns: [] }, entries: [] } },
      { status: 500, body: { error: "unavailable" } },
      { status: 400, body: { ok: false, problems: ["score is required"] } },
      "offline",
    ]);
    const boards = client(impl, storage, { now: 0 });
    expect(await boards.board(5)).toEqual({ game: { id: "maze", name: "The Maze of Time", columns: [] }, entries: [] });
    expect(calls[0]!.url).toBe("https://leaderboards.test/v1/games/maze/board?limit=5");
    expect(await boards.board()).toBeNull();
    expect(await boards.validate({ initials: "PET" })).toEqual({ ok: false, problems: ["score is required"] });
    expect(await boards.validate({ initials: "PET" })).toBeNull();
  });
});

describe("fetchBoards", () => {
  it("returns every listed board or null", async () => {
    const good = fakeFetch([{ status: 200, body: { games: [{ id: "maze", name: "The Maze of Time", columns: [], entries: [] }] } }]);
    expect(await fetchBoards(5, "https://leaderboards.test", good.impl)).toEqual({
      games: [{ id: "maze", name: "The Maze of Time", columns: [], entries: [] }],
    });
    expect(good.calls[0]!.url).toBe("https://leaderboards.test/v1/board?limit=5");
    expect(await fetchBoards(5, "https://leaderboards.test", fakeFetch(["offline"]).impl)).toBeNull();
    expect(await fetchBoards(5, "https://leaderboards.test", fakeFetch([{ status: 500 }]).impl)).toBeNull();
  });
});

describe("formatValue", () => {
  it("formats durations, decimals, integers and unknowns", () => {
    expect(formatValue(33.2, "duration")).toBe("0:33");
    expect(formatValue(600, "duration")).toBe("10:00");
    expect(formatValue(12.35, "decimal")).toBe("12.35");
    expect(formatValue(1200, "integer")).toBe("1,200");
    expect(formatValue(null, "integer")).toBe("—");
    expect(formatValue(undefined, "duration")).toBe("—");
  });
});
