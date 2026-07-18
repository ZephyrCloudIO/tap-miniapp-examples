import { readFile, writeFile } from "node:fs/promises";

const packageUrl = new URL("../pkg/package.json", import.meta.url);
const metadata = JSON.parse(await readFile(packageUrl, "utf8"));

// The generated initializer has observable side effects: it instantiates the
// shared Rust/WASM runtime used by the surface and lifecycle exposes.
metadata.sideEffects = true;

await writeFile(packageUrl, `${JSON.stringify(metadata, null, 2)}\n`);
