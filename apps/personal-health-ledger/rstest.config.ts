import { defineConfig } from "@rstest/core";
export default defineConfig({
  testEnvironment: "node",
  exclude: ["tests/e2e/**/*.test.ts"],
});
