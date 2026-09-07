import { describe, expect, it } from "vitest";
import { GAMES } from "../src/registry.ts";
import { buildRegistry, validateGame } from "../src/rules.ts";
import decimalWithoutPrecision from "./fixtures/invalid/decimal-without-precision.json";
import httpOrigin from "./fixtures/invalid/http-origin.json";
import rankingUndeclared from "./fixtures/invalid/ranking-undeclared.json";
import reservedField from "./fixtures/invalid/reserved-field.json";
import unknownProperty from "./fixtures/invalid/unknown-property.json";
import gate from "./fixtures/gate.json";
import maze from "./fixtures/maze.json";
import sprint from "./fixtures/sprint.json";

describe("validateGame", () => {
  it("accepts the fixtures and applies defaults", () => {
    const result = validateGame(maze);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.fields.score).toEqual({ type: "integer", required: true, min: 10, max: 5000000, step: 10, precision: 0, onInvalid: "reject" });
    expect(result.game.fields.playTime).toMatchObject({ type: "decimal", required: false, precision: 3, onInvalid: "unknown" });
    expect(result.game.ranking[0]).toEqual({ field: "score", order: "desc", unknown: "last" });
    expect(result.game.columns[0]).toEqual({ field: "score", label: "Score", format: "integer" });
    expect(result.game).not.toHaveProperty("proof");
    expect(validateGame(sprint).ok).toBe(true);
    const gated = validateGame(gate);
    expect(gated.ok && gated.game.proof).toBe("turnstile");
  });

  it("takes a proof declaration of turnstile only, and keeps token out of the field names", () => {
    expect(validateGame({ ...maze, proof: "turnstile" }).ok).toBe(true);
    const other = validateGame({ ...maze, proof: "captcha" });
    expect(!other.ok && other.problems.join("\n")).toMatch(/proof must be "turnstile"/);
    const reserved = validateGame({ ...maze, fields: { ...maze.fields, token: { type: "integer" } } });
    expect(!reserved.ok && reserved.problems.join("\n")).toMatch(/"token" is a reserved name/);
  });

  it("rejects each invalid fixture with a reason", () => {
    for (const [fixture, expected] of [
      [reservedField, /reserved name/],
      [decimalWithoutPrecision, /precision/],
      [rankingUndeclared, /undeclared field "points"/],
      [httpOrigin, /origins item .* is not allowed/],
      [unknownProperty, /unknown property/],
    ] as const) {
      const result = validateGame(fixture);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems.join("\n")).toMatch(expected);
    }
  });

  it("refuses a factor bound on an optional or self-referencing field", () => {
    const base = { ...maze, id: "alt" };
    const optionalRef = validateGame({
      ...base,
      fields: { ...maze.fields, score: { ...maze.fields.score, required: false } },
    });
    expect(!optionalRef.ok && optionalRef.problems.join("\n")).toMatch(/must be required/);
    const selfRef = validateGame({
      ...base,
      fields: { ...maze.fields, playTime: { ...maze.fields.playTime, max: { field: "playTime", factor: 1 } } },
    });
    expect(!selfRef.ok && selfRef.problems.join("\n")).toMatch(/cannot refer to itself/);
  });

  it("refuses a dirty default for the initials", () => {
    const result = validateGame({ ...maze, initials: { default: "ASS" } });
    expect(!result.ok && result.problems.join("\n")).toMatch(/clean upper-case initials/);
  });

  it("builds a registry and refuses duplicate ids", () => {
    const registry = buildRegistry([maze, sprint]);
    expect([...registry.keys()]).toEqual(["maze", "sprint"]);
    expect(() => buildRegistry([maze, maze])).toThrow(/duplicate id "maze"/);
    expect(() => buildRegistry([reservedField])).toThrow(/invalid registry/);
  });

  it("builds the production registry", () => {
    expect(() => buildRegistry(GAMES)).not.toThrow();
  });
});
