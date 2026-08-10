import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // Entry points and the vendor SDK adapter are wiring, not logic. Their behaviour is
      // covered through the modules they compose and by live verification — mocking the
      // Speech SDK to raise this number would be test theatre. See docs/adr/0007.
      exclude: ["src/client/main.ts", "src/server/index.ts", "src/client/azureSpeech.ts"],
    },
  },
});
