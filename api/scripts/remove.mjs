import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCloudflareEnv } from "./env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [game, id] = process.argv.slice(2);

if (!/^[a-z][a-z0-9-]{1,31}$/.test(game ?? "") || !/^[1-9][0-9]{0,15}$/.test(id ?? "")) {
  console.error("usage: npm run api:remove -- <game> <entry id>");
  process.exit(2);
}

loadCloudflareEnv(ROOT);
const windows = process.platform === "win32";
const result = spawnSync(
  windows ? "npx.cmd" : "npx",
  [
    "wrangler", "d1", "execute", "coney-arcade-leaderboards", "--remote", "--yes",
    "-c", "api/wrangler.jsonc",
    "--command", `DELETE FROM entries WHERE game = '${game}' AND id = ${id}`,
  ],
  { cwd: ROOT, stdio: "inherit", shell: windows },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
