import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WANTED = new Set(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

export function loadCloudflareEnv(rootDir) {
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return;
  const file = join(rootDir, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!WANTED.has(key) || process.env[key]) continue;
    process.env[key] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
