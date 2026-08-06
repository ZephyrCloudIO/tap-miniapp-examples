/* Headless boot verification for the vendored Kart Royale preview build. */
import puppeteer from "puppeteer";

const ORIGIN = process.env.KART_ORIGIN ?? "http://localhost:4173";

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--window-size=1280,720",
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});

await page.goto(ORIGIN, { waitUntil: "domcontentloaded", timeout: 30_000 });

// The game sets window.__gameReady = true on frame 8 (after boot + first frames).
await page.waitForFunction(() => window.__gameReady === true, { timeout: 60_000 });
// The boot curtain fades for 700ms before removal; wait it out so a slow
// software rasteriser cannot flake the check.
await page.waitForFunction(() => !document.querySelector("#boot"), { timeout: 15_000 });

const state = await page.evaluate(() => ({
  hasCanvas: !!document.querySelector(".kart-host #app canvas"),
  hasUi: !!document.querySelector(".kart-host #ui .kr"),
  bootGone: !document.querySelector("#boot"),
  loopHealth: window.__loopHealth ? window.__loopHealth() : null,
}));
console.log(JSON.stringify(state, null, 2));
console.log("errors:", errors.length ? errors : "none");

await page.screenshot({ path: process.env.KART_SHOT ?? "/tmp/kart-boot.png" });

await browser.close();
if (errors.length) {
  console.error("BOOT ERRORS PRESENT");
  process.exit(1);
}
if (!state.hasCanvas || !state.bootGone) {
  console.error("BOOT INCOMPLETE");
  process.exit(1);
}
console.log("BOOT OK");
