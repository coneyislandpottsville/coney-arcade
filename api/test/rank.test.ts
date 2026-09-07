import { describe, expect, it } from "vitest";
import { encodeRankKey } from "../src/rank.ts";
import { validateGame } from "../src/rules.ts";
import type { Game } from "../src/types.ts";
import maze from "./fixtures/maze.json";
import sprint from "./fixtures/sprint.json";

function game(input: unknown): Game {
  const result = validateGame(input);
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.game;
}

const MAZE = game(maze);
const SPRINT = game(sprint);

function order(g: Game, rows: Array<Record<string, bigint | null>>): number[] {
  return rows
    .map((units, index) => ({ key: encodeRankKey(g, units), index }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((r) => r.index);
}

describe("encodeRankKey", () => {
  it("has a fixed width per component", () => {
    const key = encodeRankKey(MAZE, { score: 840n, playTime: 33200n, levelReached: 4n });
    expect(key).toHaveLength(2 * 17);
    expect(key).toMatch(/^[01][0-9a-f]{16}[01][0-9a-f]{16}$/);
  });

  it("ranks a higher score first when the order is desc", () => {
    const rows = [{ score: 10n, playTime: null }, { score: 5_000_000n, playTime: null }, { score: 840n, playTime: null }];
    expect(order(MAZE, rows)).toEqual([1, 2, 0]);
  });

  it("breaks a score tie by the faster time, with unknown last", () => {
    const rows = [
      { score: 500n, playTime: null },
      { score: 500n, playTime: 30_000n },
      { score: 500n, playTime: 12_000n },
      { score: 500n, playTime: 0n },
    ];
    expect(order(MAZE, rows)).toEqual([3, 2, 1, 0]);
  });

  it("keeps insertion order for identical keys", () => {
    const rows = [{ score: 500n, playTime: 12_000n }, { score: 500n, playTime: 12_000n }];
    expect(order(MAZE, rows)).toEqual([0, 1]);
  });

  it("puts unknown first when a component says so, and sorts asc decimals in units", () => {
    const rows = [
      { laps: 3n, time: 1234n },
      { laps: null, time: 999n },
      { laps: 3n, time: 1200n },
      { laps: 4n, time: 9_999n },
    ];
    expect(order(SPRINT, rows)).toEqual([1, 3, 2, 0]);
  });

  it("orders negative and positive integers correctly across zero", () => {
    const g = game({
      ...sprint,
      id: "delta",
      fields: { delta: { type: "integer", required: true, min: -1000, max: 1000 } },
      ranking: [{ field: "delta", order: "asc" }],
      columns: [{ field: "delta", label: "Delta" }],
    });
    const rows = [{ delta: 0n }, { delta: -1000n }, { delta: 1000n }, { delta: -1n }, { delta: 1n }];
    expect(order(g, rows)).toEqual([1, 3, 0, 4, 2]);
  });
});
