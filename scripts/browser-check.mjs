// One-off verification that the built app loads, renders and wires up in a real browser.
// Not part of the suite (no browser in CI here) — run manually: node scripts/browser-check.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:8790";

const browser = await chromium.launch({
  // Reuse a browser that is already on this machine rather than downloading another.
  ...(process.env["CHROME_PATH"] ? { executablePath: process.env["CHROME_PATH"] } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });

const report = {
  title: await page.title(),
  languagesA: await page.locator("#lang-a option").count(),
  languagesB: await page.locator("#lang-b option").count(),
  defaultA: await page.locator("#lang-a").inputValue(),
  defaultB: await page.locator("#lang-b").inputValue(),
  statusText: (await page.locator("#status-text").textContent())?.trim(),
  statusState: await page.locator("#status").getAttribute("data-state"),
  emptyStateVisible: await page.locator("#transcript-empty").isVisible(),
  releaseDisabled: await page.locator("#release").isDisabled(),
  noticeHidden: await page.locator("#notice").isHidden(),
};

// The floor control must be reachable and operable by keyboard alone.
await page.keyboard.press("1");
await page.waitForTimeout(2500);
report.afterKey1 = {
  channelALive: await page.locator("#channel-a").getAttribute("data-live"),
  floorAPressed: await page.locator("#floor-a").getAttribute("aria-pressed"),
  floorALabel: (await page.locator("#floor-a-label").textContent())?.trim(),
  releaseEnabled: !(await page.locator("#release").isDisabled()),
  status: (await page.locator("#status-text").textContent())?.trim(),
};
await page.screenshot({ path: "browser-check-live.png", fullPage: true });

await page.keyboard.press("Escape");
await page.waitForTimeout(800);
report.afterEscape = {
  channelALive: await page.locator("#channel-a").getAttribute("data-live"),
  releaseDisabled: await page.locator("#release").isDisabled(),
};

// Contrast of the actual rendered pixels, not just the token values.
report.computed = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const caption = getComputedStyle(document.querySelector(".caption__text"));
  return { bg: body.backgroundColor, ink: body.color, captionSize: caption.fontSize };
});

await page.screenshot({ path: "browser-check.png", fullPage: true });

report.consoleErrors = consoleErrors;
report.pageErrors = pageErrors;
console.log(JSON.stringify(report, null, 2));

await browser.close();
process.exit(pageErrors.length > 0 ? 1 : 0);
