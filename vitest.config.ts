import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "examples/**/*.test.ts",
      "release/**/*.test.ts",
    ],
    setupFiles: ["tests/setup/no-network.ts", "tests/setup/no-env-file.ts"],
    // End-to-end tests run dozens of real HTTP calls against the in-process mock.
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli/index.ts"],
    },
  },
});
