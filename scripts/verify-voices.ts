/**
 * Verifies the language catalog against the live Azure services.
 *
 * The catalog in src/shared/languages.ts is only as good as its last check — voices are
 * added and retired. This script is the detector for U-10 and U-14: it fails loudly if any
 * voice or translation code we claim to support no longer works.
 *
 * It does NOT trust the voice list. `voices/list` has been observed advertising a voice the
 * synthesiser in the same region refuses (en-IN-Diya, eastus2, 2026-08-18 — see ADR-0014), so
 * every catalog voice is proven here by synthesising real audio with it.
 *
 *   npm run verify:voices
 *
 * Requires `az login` (or any DefaultAzureCredential source) and the env vars in .env.example.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { LANGUAGES, type Language } from "../src/shared/languages.js";
import { auditVoiceAvailability, type SynthesisProbe } from "../src/shared/voiceAvailability.js";

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const endpoint = process.env["SPEECH_ENDPOINT"];
const region = process.env["SPEECH_REGION"];

if (!endpoint || !region) {
  console.error("Set SPEECH_ENDPOINT and SPEECH_REGION (see .env.example).");
  process.exit(2);
}

const credential = new DefaultAzureCredential();
const entra = await credential.getToken("https://cognitiveservices.azure.com/.default");
if (!entra) {
  console.error("Could not acquire a Microsoft Entra token. Run `az login`.");
  process.exit(2);
}

const stsResponse = await fetch(`${endpoint.replace(/\/$/, "")}/sts/v1.0/issueToken`, {
  method: "POST",
  headers: { Authorization: `Bearer ${entra.token}`, "Content-Length": "0" },
});
if (!stsResponse.ok) {
  console.error(`STS exchange failed: ${stsResponse.status} ${stsResponse.statusText}`);
  process.exit(2);
}
const speechToken = await stsResponse.text();

const [voicesResponse, translatorResponse] = await Promise.all([
  fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { Authorization: `Bearer ${speechToken}` },
  }),
  fetch("https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation"),
]);

if (!voicesResponse.ok) {
  console.error(`Voice list failed: ${voicesResponse.status}`);
  process.exit(2);
}
if (!translatorResponse.ok) {
  console.error(`Translator language list failed: ${translatorResponse.status}`);
  process.exit(2);
}

const listedVoices = new Set(
  ((await voicesResponse.json()) as { ShortName: string }[]).map((v) => v.ShortName),
);
const translationTargets = new Set(
  Object.keys(
    ((await translatorResponse.json()) as { translation: Record<string, unknown> }).translation,
  ),
);

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );

/** Synthesise one short phrase. Availability is what we are testing, not audio quality. */
async function probeVoice(lang: Language): Promise<SynthesisProbe> {
  const ssml =
    `<speak version='1.0' xml:lang='${escapeXml(lang.speechLocale)}'>` +
    `<voice name='${escapeXml(lang.voice)}'>hello</voice></speak>`;

  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${speechToken}`,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "speechbridge-verify-voices",
      },
      body: ssml,
    });

    if (!response.ok) {
      return { status: "failed", httpStatus: response.status };
    }
    return { status: "ok", bytes: (await response.arrayBuffer()).byteLength };
  } catch {
    // A transport failure is still a failure to prove availability, which is what we report.
    return { status: "failed", httpStatus: 0 };
  }
}

// Distinct voices only — several languages may share one multilingual voice.
const distinctVoices = new Map<string, Language>();
for (const lang of LANGUAGES) {
  if (!distinctVoices.has(lang.voice)) distinctVoices.set(lang.voice, lang);
}

console.log(
  `Probing ${distinctVoices.size} distinct voices in ${region} by synthesising with each...`,
);

const probes = new Map<string, SynthesisProbe>();
const queue = [...distinctVoices.values()];
const WORKERS = 4; // Quick enough to be usable, gentle enough not to trip throttling.

await Promise.all(
  Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
    for (let lang = queue.shift(); lang !== undefined; lang = queue.shift()) {
      const probe = await probeVoice(lang);
      probes.set(lang.voice, probe);
      const detail = probe.status === "ok" ? `ok, ${probe.bytes} bytes` : `FAILED ${probe.httpStatus}`;
      console.log(`  ${probe.status === "ok" ? "+" : "x"} ${lang.voice} — ${detail}`);
    }
  }),
);

const problems = auditVoiceAvailability(LANGUAGES, { listedVoices, translationTargets, probes });

console.log(
  `\nChecked ${LANGUAGES.length} languages against ${listedVoices.size} listed voices, ` +
    `each proven by synthesis.`,
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log("All catalog voices synthesised successfully and all translation codes are valid.");
