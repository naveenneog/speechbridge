/**
 * Generates a speech fixture for the end-to-end browser check.
 *
 * Chromium can be handed a WAV file to play into the microphone
 * (--use-file-for-fake-audio-capture), which lets the browser check drive the real
 * recognition path rather than only proving the page loads.
 *
 * Uses the REST synthesis endpoint deliberately: it needs no WebSocket, sidestepping the
 * Node incompatibility in ADR-0004.
 *
 *   npm run fixture:speech
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const endpoint = process.env["SPEECH_ENDPOINT"];
const region = process.env["SPEECH_REGION"];
if (!endpoint || !region) {
  console.error("Set SPEECH_ENDPOINT and SPEECH_REGION (see .env.example).");
  process.exit(2);
}

const UTTERANCES = [
  {
    file: "en-utterance.wav",
    locale: "en-US",
    voice: "en-US-AndrewMultilingualNeural",
    text: "Good morning. I would like to schedule the project review for next Tuesday afternoon.",
  },
  {
    file: "hi-utterance.wav",
    locale: "hi-IN",
    voice: "hi-IN-AaravNeural",
    text: "नमस्ते। मैं कल सुबह बैठक में शामिल हो सकता हूँ।",
  },
];

const credential = new DefaultAzureCredential();
const entra = await credential.getToken("https://cognitiveservices.azure.com/.default");
if (!entra) {
  console.error("No Microsoft Entra token. Run `az login`.");
  process.exit(2);
}

const sts = await fetch(`${endpoint.replace(/\/$/, "")}/sts/v1.0/issueToken`, {
  method: "POST",
  headers: { Authorization: `Bearer ${entra.token}`, "Content-Length": "0" },
});
if (!sts.ok) {
  console.error(`STS exchange failed: ${sts.status}`);
  process.exit(2);
}
const speechToken = await sts.text();

const outDir = resolve(here, "../fixtures");
mkdirSync(outDir, { recursive: true });

for (const utterance of UTTERANCES) {
  const ssml =
    `<speak version='1.0' xml:lang='${utterance.locale}'>` +
    `<voice name='${utterance.voice}'>` +
    // Leading and trailing silence so the recognizer sees a clean utterance boundary
    // when Chromium loops the file.
    `<break time='700ms'/>${utterance.text}<break time='1500ms'/>` +
    `</voice></speak>`;

  const audio = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${speechToken}`,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
      "User-Agent": "speechbridge-fixture",
    },
    body: ssml,
  });
  if (!audio.ok) {
    console.error(`Synthesis failed for ${utterance.file}: ${audio.status} ${await audio.text()}`);
    process.exit(2);
  }

  const outFile = resolve(outDir, utterance.file);
  writeFileSync(outFile, Buffer.from(await audio.arrayBuffer()));
  console.log(`Wrote ${outFile}  (${utterance.locale}) "${utterance.text}"`);
}
