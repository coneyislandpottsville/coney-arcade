import { describe, expect, it } from "vitest";
import { validateGame } from "../src/rules.ts";
import type { Game } from "../src/types.ts";
import { normalizeSubmission } from "../src/validate.ts";
import maze from "./fixtures/maze.json";
import sprint from "./fixtures/sprint.json";

function game(input: unknown): Game {
  const result = validateGame(input);
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.game;
}

const MAZE = game(maze);
const SPRINT = game(sprint);
const ID = "9b2e6c1a-6a1f-4e3b-9d3c-1d2f3a4b5c6d";

const valid = { submissionId: ID, client: "maze2d", initials: "PET", score: 840, playTime: 33.2, levelReached: 4 };

function problems(g: Game, body: unknown): string[] {
  const result = normalizeSubmission(g, body);
  return result.ok ? [] : result.problems;
}

describe("normalizeSubmission", () => {
  it("normalizes a valid maze run", () => {
    const result = normalizeSubmission(MAZE, valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ submissionId: ID, client: "maze2d", initials: "PET" });
    expect(result.value.fields).toEqual({ score: 840, playTime: 33.2, levelReached: 4 });
    expect(result.value.units).toEqual({ score: 840n, playTime: 33200n, levelReached: 4n });
    expect(result.value.canonical).toBe('{"score":840,"playTime":33.2,"levelReached":4}');
  });

  it("lower-cases the submission id and refuses anything but a UUID", () => {
    const upper = normalizeSubmission(MAZE, { ...valid, submissionId: ID.toUpperCase() });
    expect(upper.ok && upper.value.submissionId).toBe(ID);
    expect(problems(MAZE, { ...valid, submissionId: "run-1" })).toEqual(["submissionId must be a UUID"]);
    expect(problems(MAZE, { ...valid, submissionId: 7 })).toEqual(["submissionId must be a UUID"]);
  });

  it("requires a registered client", () => {
    expect(problems(MAZE, { ...valid, client: "web" })).toEqual(["client must be one of maze2d, maze3d"]);
    expect(problems(MAZE, { ...valid, client: undefined })).toEqual(["client must be one of maze2d, maze3d"]);
  });

  it("cleans initials and falls back to the game default", () => {
    const messy = normalizeSubmission(MAZE, { ...valid, initials: " pe-t!x" });
    expect(messy.ok && messy.value.initials).toBe("PET");
    const empty = normalizeSubmission(MAZE, { ...valid, initials: "" });
    expect(empty.ok && empty.value.initials).toBe("CNY");
    const missing = normalizeSubmission(MAZE, { ...valid, initials: undefined });
    expect(missing.ok && missing.value.initials).toBe("CNY");
    const blocked = normalizeSubmission(MAZE, { ...valid, initials: "ass" });
    expect(blocked.ok && blocked.value.initials).toBe("CNY");
  });

  it("rejects a missing or malformed required score", () => {
    expect(problems(MAZE, { ...valid, score: undefined })).toEqual(["score is required"]);
    expect(problems(MAZE, { ...valid, score: null })).toEqual(["score is required"]);
    expect(problems(MAZE, { ...valid, score: "840" })).toEqual(["score must be a number"]);
    expect(problems(MAZE, { ...valid, score: 845 })).toEqual(["score must be a multiple of 10"]);
    expect(problems(MAZE, { ...valid, score: 84.5 })).toEqual(["score must be an integer"]);
    expect(problems(MAZE, { ...valid, score: 0 })).toEqual(["score must be at least 10"]);
    expect(problems(MAZE, { ...valid, score: 5_000_010 })).toEqual(["score must be at most 5000000"]);
    expect(problems(MAZE, { ...valid, score: Number.NaN })).toEqual(["score must be a number"]);
  });

  it("stores an invalid optional play time as unknown instead of rejecting", () => {
    for (const playTime of ["33", -1, 302.401, 1e300]) {
      const result = normalizeSubmission(MAZE, { ...valid, playTime });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.fields.playTime).toBeNull();
    }
    const missing = normalizeSubmission(MAZE, { ...valid, playTime: undefined });
    expect(missing.ok && missing.value.fields.playTime).toBeNull();
    expect(missing.ok && missing.value.units.playTime).toBeNull();
  });

  it("bounds the play time by the score through the declared factor", () => {
    const edge = normalizeSubmission(MAZE, { ...valid, playTime: 302.4 });
    expect(edge.ok && edge.value.fields.playTime).toBe(302.4);
    const under = normalizeSubmission(MAZE, { ...valid, playTime: 302.4004 });
    expect(under.ok && under.value.fields.playTime).toBe(302.4);
    const over = normalizeSubmission(MAZE, { ...valid, playTime: 302.4006 });
    expect(over.ok && over.value.fields.playTime).toBeNull();
    const past = normalizeSubmission(MAZE, { ...valid, playTime: 302.5 });
    expect(past.ok && past.value.fields.playTime).toBeNull();
  });

  it("rounds decimals to the declared precision before anything else", () => {
    const result = normalizeSubmission(MAZE, { ...valid, playTime: 33.2004 });
    expect(result.ok && result.value.fields.playTime).toBe(33.2);
    expect(result.ok && result.value.units.playTime).toBe(33200n);
  });

  it("rejects an invalid field whose rule says reject", () => {
    expect(problems(MAZE, { ...valid, levelReached: 151 })).toEqual(["levelReached must be at most 150"]);
    expect(problems(MAZE, { ...valid, levelReached: 0 })).toEqual(["levelReached must be at least 1"]);
    expect(problems(MAZE, { ...valid, levelReached: 1.5 })).toEqual(["levelReached must be an integer"]);
    const absent = normalizeSubmission(MAZE, { ...valid, levelReached: undefined });
    expect(absent.ok && absent.value.fields.levelReached).toBeNull();
  });

  it("drops fields the game never declared", () => {
    const result = normalizeSubmission(MAZE, { ...valid, timeLeft: 41, name: "Pete" });
    expect(result.ok && Object.keys(result.value.fields)).toEqual(["score", "playTime", "levelReached"]);
  });

  it("collects every problem at once", () => {
    expect(problems(MAZE, { initials: "X" })).toEqual([
      "submissionId must be a UUID",
      "client must be one of maze2d, maze3d",
      "score is required",
    ]);
    expect(problems(MAZE, [])).toEqual(["body must be a JSON object"]);
    expect(problems(MAZE, null)).toEqual(["body must be a JSON object"]);
  });

  it("handles a game with a required decimal and an optional integer", () => {
    const result = normalizeSubmission(SPRINT, { submissionId: ID, client: "sprint", initials: "ZED", time: 12.345, laps: 3 });
    expect(result.ok && result.value.fields).toEqual({ time: 12.35, laps: 3 });
    expect(result.ok && result.value.units).toEqual({ time: 1235n, laps: 3n });
    expect(problems(SPRINT, { submissionId: ID, client: "sprint", time: 0 })).toEqual(["time must be at least 0.01"]);
    const badLaps = normalizeSubmission(SPRINT, { submissionId: ID, client: "sprint", time: 9, laps: 100 });
    expect(badLaps.ok && badLaps.value.fields.laps).toBeNull();
  });
});
