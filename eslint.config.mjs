import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Google Apps Script files: CommonJS export for Vitest, and top-level
    // entry points (doPost, setup, selfTest) that Apps Script calls by name.
    files: ["apps-script/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^(doPost|setup|selfTest)$" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
