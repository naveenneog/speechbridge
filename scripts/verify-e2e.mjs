/**
 * End-to-end proof that the demo actually translates.
 *
 * Feeds a real spoken WAV into Chromium's fake microphone, takes the floor, and asserts
 * that a transcript entry appears containing Devanagari — i.e. English speech went in and
 * a Hindi translation came out through the real Azure path, in the real browser.
 *
 *   npm run fixture:speech && npm run verify:e2e
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env["BASE"] ?? "http://localhost:8790";
const wav = resolve(here, "../fixtures/en-utterance.wav");

if (!existsSync(wav)) {
  console.error(`Missing ${wav} — run: npm run fixture:speech`);
  process.exit(2);
}

const browser = await chromium.launch({
  ...(process.env["CHROME_PATH"] ? { executablePath: process.env["CHROME_PATH"] } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector('#status[data-state="ready"]', { timeout: 20000 });

// A speaks English, B hears Hindi.
await page.selectOption("#lang-a", "en");
await page.selectOption("#lang-b", "hi");
await page.click("#floor-a");

// Wait for a settled turn to reach the transcript.
await page.waitForSelector(".turn", { timeout: 45000 });
await page.waitForTimeout(3000);

const turns = await page.$$eval(".turn", (nodes) =>
  nodes.map((n) => ({
    who: n.querySelector(".turn__who")?.textContent?.trim(),
    original: n.querySelector(".turn__original")?.textContent?.trim(),
    translated: n.querySelector(".turn__translated")?.textContent?.trim(),
    translatedLang: n.querySelector(".turn__translated")?.getAttribute("lang"),
    latency: n.querySelector(".turn__latency")?.textContent?.trim(),
  })),
);

const liveCaptionB = await page.locator("#caption-b").textContent();
await page.screenshot({ path: "e2e-result.png", fullPage: true });
await browser.close();

const first = turns[0];
const devanagari = /[\u0900-\u097F]/;

console.log(JSON.stringify({ turns, liveCaptionB, pageErrors }, null, 2));

const problems = [];
if (!first) problems.push("no transcript entry was produced");
if (first && !/morning|schedule|project|review/i.test(first.original ?? "")) {
  problems.push(`recognized text does not match the spoken fixture: "${first.original}"`);
}
if (first && !devanagari.test(first.translated ?? "")) {
  problems.push(`translation is not in Devanagari: "${first.translated}"`);
}
if (first && first.translatedLang !== "hi") {
  problems.push(`translated element lang is "${first.translatedLang}", expected "hi"`);
}
if (first && !/\d\.\ds/.test(first.latency ?? "")) {
  problems.push(`no latency was measured: "${first.latency}"`);
}
if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join("; ")}`);

if (problems.length > 0) {
  console.error("\nE2E FAILED:");
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}

console.log("\nE2E PASS — English speech in, spoken Hindi translation out, latency measured.");
