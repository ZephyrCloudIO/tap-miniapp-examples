import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const publicApiUrl = process.env.TAP_CALENDAR_PUBLIC_API_URL ?? "";

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: "./src/main.tsx" },
    define: {
      __TAP_CALENDAR_PUBLIC_API_URL__: JSON.stringify(publicApiUrl),
    },
  },
  html: {
    title: "Book a meeting · TAP Calendar",
    meta: {
      charset: { charset: "UTF-8" },
      viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
      robots: "noindex, nofollow, noarchive",
      referrer: "no-referrer",
      "theme-color": "#6758e8",
    },
  },
  output: {
    cleanDistPath: true,
    sourceMap: false,
    distPath: { root: "dist" },
  },
  performance: {
    chunkSplit: { strategy: "split-by-experience" },
  },
});
