import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const migrations = await readD1Migrations(join(root, "migrations"));

export default defineConfig({
  test: {
    root,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: join(root, "wrangler.jsonc") },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, TURNSTILE_SECRET: "test-secret" } },
    }),
  ],
});
