/**
 * Verifies the language catalog against the live Azure services.
 *
 * The catalog in src/shared/languages.ts is only as good as its last check — voices are
 * added and retired. This script is the detector for U-10: it fails loudly if any voice
 * or translation code we claim to support no longer exists.
 *
 *   npm run verify:voices
 *
 * Requires `az login` (or any DefaultAzureCredential source) and the env vars in .env.example.
 */
import { DefaultAzureCredential } from "@azure/identity";
import { LANGUAGES } from "../src/shared/languages.js";

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

const liveVoices = new Set(
  ((await voicesResponse.json()) as { ShortName: string }[]).map((v) => v.ShortName),
);
const liveTargets = new Set(
  Object.keys(
    ((await translatorResponse.json()) as { translation: Record<string, unknown> }).translation,
  ),
);

const problems: string[] = [];
for (const lang of LANGUAGES) {
  if (!liveVoices.has(lang.voice)) {
    problems.push(`${lang.code}: voice "${lang.voice}" does not exist in region ${region}`);
  }
  if (!liveTargets.has(lang.code)) {
    problems.push(`${lang.code}: not a valid translation target code`);
  }
}

console.log(`Checked ${LANGUAGES.length} languages against ${liveVoices.size} live voices.`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log("All catalog voices and translation codes verified against the live service.");
