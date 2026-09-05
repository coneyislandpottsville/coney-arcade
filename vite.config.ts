import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    modulePreload: false,
  },
  server: { host: true },
  preview: { host: true },
});
