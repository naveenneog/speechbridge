/**
 * End-to-end proof that the demo actually translates — in both directions.
 *
 * Feeds real spoken audio into Chromium's fake microphone, takes the floor, and asserts a
 * translation appears in the transcript. Runs twice, because "bidirectional" is the whole
 * product claim and proving one direction proves half a product:
 *
 *   A speaks English -> B must hear Hindi   (Devanagari out)
 *   B speaks Hindi   -> A must hear English (Latin out)
 *
 *   npm run fixture:speech && npm run verify:e2e
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env["BASE"] ?? "http://localhost:8790";

const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[A-Za-z]/;

const DIRECTIONS = [
  {
    name: "A speaks English -> B hears Hindi",
    wav: resolve(here, "../fixtures/en-utterance.wav"),
    speaker: "a",
    expectOriginal: /morning|schedule|project|review/i,
    expectTranslated: DEVANAGARI,
    expectLang: "hi",
  },
  {
    name: "B speaks Hindi   -> A hears English",
    wav: resolve(here, "../fixtures/hi-utterance.wav"),
    speaker: "b",
    expectOriginal: DEVANAGARI,
    expectTranslated: LATIN,
    expectLang: "en",
  },
];

async function runDirection(direction) {
  if (!existsSync(direction.wav)) {
    return { name: direction.name, problems: [`missing ${direction.wav} — run fixture:speech`] };
  }

  const browser = await chromium.launch({
    ...(process.env["CHROME_PATH"] ? { executablePath: process.env["CHROME_PATH"] } : {}),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${direction.wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const pageErrors = [];
  try {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector('#status[data-state="ready"]', { timeout: 20000 });
    await page.selectOption("#lang-a", "en");
    await page.selectOption("#lang-b", "hi");
    // The buttons are now press-and-hold, so a click would open and immediately close the
    // microphone. Use the keyboard latch (1 / 2), which is the accessible equivalent.
    await page.keyboard.press(direction.speaker === "a" ? "1" : "2");

    await page.waitForSelector(".turn", { timeout: 45000 });
    await page.waitForTimeout(2500);

    const turn = await page.$eval(".turn", (n) => ({
      who: n.querySelector(".turn__who")?.textContent?.trim(),
      original: n.querySelector(".turn__original")?.textContent?.trim(),
      translated: n.querySelector(".turn__translated")?.textContent?.trim(),
      translatedLang: n.querySelector(".turn__translated")?.getAttribute("lang"),
      latency: n.querySelector(".turn__latency")?.textContent?.trim(),
    }));

    const problems = [];
    if (!direction.expectOriginal.test(turn.original ?? "")) {
      problems.push(`recognized text unexpected: "${turn.original}"`);
    }
    if (!direction.expectTranslated.test(turn.translated ?? "")) {
      problems.push(`translation in the wrong script: "${turn.translated}"`);
    }
    if (turn.translatedLang !== direction.expectLang) {
      problems.push(`lang was "${turn.translatedLang}", expected "${direction.expectLang}"`);
    }
    if (!/\d\.\ds/.test(turn.latency ?? "")) {
      problems.push(`no latency measured: "${turn.latency}"`);
    }
    if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join("; ")}`);

    await page.screenshot({ path: `e2e-${direction.speaker}.png`, fullPage: true });
    return { name: direction.name, turn, problems };
  } catch (cause) {
    return { name: direction.name, problems: [String(cause).split("\n")[0]] };
  } finally {
    await browser.close();
  }
}

const results = [];
for (const direction of DIRECTIONS) {
  results.push(await runDirection(direction));
}

for (const result of results) {
  console.log(`\n${result.name}`);
  if (result.turn) {
    console.log(`  heard      : ${result.turn.original}`);
    console.log(`  translated : ${result.turn.translated}  [lang=${result.turn.translatedLang}]`);
    console.log(`  latency    : ${result.turn.latency}`);
  }
  for (const problem of result.problems) console.log(`  x ${problem}`);
}

const failed = results.filter((r) => r.problems.length > 0);
if (failed.length > 0) {
  console.error(`\nE2E FAILED — ${failed.length} of ${results.length} direction(s).`);
  process.exit(1);
}
console.log("\nE2E PASS — both directions translate and speak, with measured latency.");
