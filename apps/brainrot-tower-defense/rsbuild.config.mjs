import { defineConfig } from "@rsbuild/core";
export default defineConfig({
  source: { entry: { index: ["./assets/styles.css", "./src/preview.mjs"] } },
  html: { title: "Brainrot Tower Defense", template: "./preview.html" },
  output: { sourceMap: false, assetPrefix: "auto" },
  tools: {
    rspack(config) {
      config.experiments = { ...config.experiments, asyncWebAssembly: true };
    }
  }
});
