import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".ironclad/gate.mjs", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The browser-check script runs in Node but contains page.evaluate bodies that execute
    // in the browser, so it legitimately references both sets of globals.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        document: "readonly",
        getComputedStyle: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
);
