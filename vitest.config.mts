import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "supabase/functions/**/*.test.ts", "apps-script/**/*.test.js"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
