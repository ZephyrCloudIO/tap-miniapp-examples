import fs from "node:fs";
import path from "node:path";

const configFilenames = [
  "tap-miniapp.config.ts",
  "tap-miniapp.config.mts",
  "tap-miniapp.config.js",
  "tap-miniapp.config.mjs",
];

export const hasTapMiniappAuthoringConfig = (appRoot) =>
  configFilenames.some((filename) => fs.existsSync(path.join(appRoot, filename)));
