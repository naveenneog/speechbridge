import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // Entry points are wiring only; their behaviour is covered through the modules they compose.
      exclude: ["src/client/main.ts", "src/server/index.ts"],
    },
  },
});
