import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: "./src/preview.tsx" },
    define: {
      __TAP_CALENDAR_GATEWAY_URL__: JSON.stringify(
        process.env.TAP_CALENDAR_GATEWAY_URL ?? "http://127.0.0.1:8787",
      ),
      __TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID__: JSON.stringify(
        process.env.TAP_CALENDAR_LEGACY_OWNER_PRINCIPAL_ID ?? "",
      ),
    },
  },
  html: { title: "TAP Calendar" },
  output: { sourceMap: false },
});
