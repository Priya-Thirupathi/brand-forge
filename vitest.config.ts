import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests are pure/mocked and need nothing running; integration tests hit a real Postgres
// (TEST_DATABASE_URL — see tests/integration/setup/testDb.ts) and are run separately via
// `npm run test:integration`, not swept in by a plain `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      // Every integration file shares one real Postgres database and truncates it in
      // `beforeEach` — running files in parallel workers races them against each other
      // (duplicate-key and missing-row failures that have nothing to do with the code under
      // test), so this project runs its files sequentially.
      { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], fileParallelism: false } },
    ],
  },
});
