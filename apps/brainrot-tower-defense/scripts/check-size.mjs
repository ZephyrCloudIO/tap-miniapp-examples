import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const wasmUrl = new URL("../pkg/brainrot_game_web_bg.wasm", import.meta.url);
const packageAssetsUrl = new URL(
  "../.tap-build/desktop/targets/desktop/assets/",
  import.meta.url,
);
const wasmBytes = (await stat(wasmUrl)).size;
const assetFiles = await readdir(packageAssetsUrl);
let assetBytes = 0;
for (const file of assetFiles) {
  assetBytes += (await stat(new URL(file, packageAssetsUrl))).size;
}

console.log(
  `bundle size report: WASM ${wasmBytes} bytes; packaged static assets ${assetBytes} bytes (${fileURLToPath(packageAssetsUrl)})`,
);
