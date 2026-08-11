// Responsive + interaction check. Not part of the suite (needs a browser and a server).
//   npm run verify:responsive
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium, devices } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env["BASE"] ?? "http://localhost:8790";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "laptop", width: 1024, height: 700 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "narrow", width: 320, height: 640 },
];

const browser = await chromium.launch({
  ...(process.env["CHROME_PATH"] ? { executablePath: process.env["CHROME_PATH"] } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const problems = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    permissions: ["microphone"],
    ...(vp.name.startsWith("phone") ? devices["Pixel 7"]?.userAgent
      ? { userAgent: devices["Pixel 7"].userAgent, hasTouch: true, isMobile: true }
      : {} : {}),
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector('#status[data-state="ready"]', { timeout: 20000 });

  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const talk = document.querySelector("#floor-a");
    const rect = talk.getBoundingClientRect();
    const overflowing = [...document.querySelectorAll("*")]
      .filter((el) => {
        // Screen-reader-only text is deliberately clipped to 1px; that is not overflow.
        if (el.classList.contains("visually-hidden")) return false;
        const style = getComputedStyle(el);
        if (style.overflowX === "auto" || style.overflowX === "scroll") return false;
        return el.scrollWidth > el.clientWidth + 2;
      })
      .map((el) => el.className || el.tagName)
      .slice(0, 5);
    return {
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      talkHeight: Math.round(rect.height),
      talkWidth: Math.round(rect.width),
      panelsStacked: (() => {
        const a = document.querySelector("#channel-a").getBoundingClientRect();
        const b = document.querySelector("#channel-b").getBoundingClientRect();
        return b.top >= a.bottom - 2;
      })(),
      overflowing,
    };
  });

  if (report.horizontalScroll) problems.push(`${vp.name}: horizontal scrollbar`);
  if (report.talkHeight < 44) problems.push(`${vp.name}: talk target only ${report.talkHeight}px tall`);
  if (report.overflowing.length) problems.push(`${vp.name}: overflow in ${report.overflowing.join(", ")}`);

  console.log(
    `${vp.name.padEnd(16)} ${String(vp.width).padStart(4)}x${String(vp.height).padEnd(4)} ` +
      `talk ${report.talkWidth}x${report.talkHeight}  stacked=${report.panelsStacked}  ` +
      `hscroll=${report.horizontalScroll}`,
  );

  await page.screenshot({ path: resolve(here, `../ui-${vp.name}.png`), fullPage: true });
  await context.close();
}

// Interaction: does clicking toggle the microphone on and off again?
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["microphone"] });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector('#status[data-state="ready"]', { timeout: 20000 });

const talk = page.locator("#floor-a");
await talk.click();
await page.waitForTimeout(1500);
const afterFirstClick = {
  pressed: await talk.getAttribute("aria-pressed"),
  label: (await page.locator("#floor-a-label").textContent())?.trim(),
  live: await page.locator("#channel-a").getAttribute("data-live"),
};
await page.screenshot({ path: resolve(here, "../ui-talking.png"), fullPage: true });

// Clicking the same button again must stop it — the control you start with is the
// control you stop with.
await talk.click();
await page.waitForTimeout(1200);
const afterSecondClick = {
  pressed: await talk.getAttribute("aria-pressed"),
  label: (await page.locator("#floor-a-label").textContent())?.trim(),
};

console.log("\nclick    ->", JSON.stringify(afterFirstClick));
console.log("click again ->", JSON.stringify(afterSecondClick));

if (afterFirstClick.pressed !== "true") problems.push("clicking did not open the microphone");
if (!afterFirstClick.label?.startsWith("Listening")) {
  problems.push(`active label was "${afterFirstClick.label}"`);
}
if (afterSecondClick.pressed !== "false") problems.push("clicking again did not stop it");
if (afterSecondClick.label !== "Tap to speak") {
  problems.push(`idle label was "${afterSecondClick.label}"`);
}

// Keyboard must reach the same states.
await page.keyboard.press("1");
await page.waitForTimeout(1200);
const viaKeyboard = await talk.getAttribute("aria-pressed");
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
const afterEscape = await talk.getAttribute("aria-pressed");
console.log(`keyboard -> pressed=${viaKeyboard}, after Esc=${afterEscape}`);
if (viaKeyboard !== "true") problems.push("keyboard (1) did not open the microphone");
if (afterEscape !== "false") problems.push("Esc did not release the microphone");

await browser.close();

if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  x ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nPASS — responsive at every width, click toggles the microphone, keyboard works.");
