import { defineConfig } from "@rstest/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  testEnvironment: "node",
  exclude: ["tests/e2e/**/*.test.ts"],
});
