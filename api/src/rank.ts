import type { Game } from "./types.ts";

const OFFSET = 1n << 63n;
const MAX = (1n << 64n) - 1n;
const WIDTH = 16;

export function encodeRankKey(game: Game, units: Record<string, bigint | null>): string {
  let key = "";
  for (const component of game.ranking) {
    const u = units[component.field];
    const knownFlag = component.unknown === "last" ? "0" : "1";
    const unknownFlag = component.unknown === "last" ? "1" : "0";
    if (u === null || u === undefined) {
      key += unknownFlag + "0".repeat(WIDTH);
      continue;
    }
    let v = u + OFFSET;
    if (component.order === "desc") v = MAX - v;
    key += knownFlag + v.toString(16).padStart(WIDTH, "0");
  }
  return key;
}
