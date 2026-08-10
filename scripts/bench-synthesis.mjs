/**
 * P-9: does the recognizer's built-in synthesis beat the chained SpeechSynthesizer?
 *
 * ADR-0005 chose to chain an explicit `SpeechSynthesizer` and said to revisit that "if the
 * measured synthesis leg dominates total latency". End-to-end measurement says it does
 * (~75-85% of the total), so this benchmark settles it with numbers instead of opinion.
 *
 * Both paths get the identical audio and the identical language pair. What is measured is
 * time from the start of the audio push to the FIRST byte of translated audio — the moment
 * the listener could actually start hearing something.
 *
 *   npm run bench:synthesis
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ADR-0004: Node's native WebSocket negotiates over HTTP/2, which the Speech service
// rejects with an unexplained 1006. Must happen before the SDK loads.
delete globalThis.WebSocket;

const sdk = await import("microsoft-cognitiveservices-speech-sdk");
const { DefaultAzureCredential } = await import("@azure/identity");

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const endpoint = process.env["SPEECH_ENDPOINT"];
const region = process.env["SPEECH_REGION"];
if (!endpoint || !region) {
  console.error("Set SPEECH_ENDPOINT and SPEECH_REGION (see .env.example).");
  process.exit(2);
}

const wav = resolve(here, "../fixtures/en-utterance.wav");
if (!existsSync(wav)) {
  console.error("Missing fixtures/en-utterance.wav — run: npm run fixture:speech");
  process.exit(2);
}
// Strip the 44-byte RIFF header; the push stream wants raw PCM.
const pcm = readFileSync(wav).subarray(44);

const TRIALS = Number(process.env["TRIALS"] ?? 5);
const SOURCE = "en-US";
const TARGET = "hi";
const VOICE = "hi-IN-AnanyaNeural";

async function speechToken() {
  const credential = new DefaultAzureCredential();
  const entra = await credential.getToken("https://cognitiveservices.azure.com/.default");
  if (!entra) throw new Error("No Entra token. Run `az login`.");
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/sts/v1.0/issueToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${entra.token}`, "Content-Length": "0" },
  });
  if (!response.ok) throw new Error(`STS exchange failed: ${response.status}`);
  return response.text();
}

function pushStream() {
  const stream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
  );
  stream.write(pcm);
  stream.close();
  return sdk.AudioConfig.fromStreamInput(stream);
}

/** Current design: recognize, then synthesize the final text in a second call. */
function chained(token) {
  return new Promise((resolve, reject) => {
    const config = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = SOURCE;
    config.addTargetLanguage(TARGET);
    config.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "350");

    const reco = new sdk.TranslationRecognizer(config, pushStream());
    const started = Date.now();
    let finalAt;

    reco.recognized = (_s, e) => {
      if (e.result.reason !== sdk.ResultReason.TranslatedSpeech) return;
      const text = e.result.translations.get(TARGET);
      if (!text || finalAt !== undefined) return;
      finalAt = Date.now() - started;

      const synthConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      synthConfig.speechSynthesisVoiceName = VOICE;
      synthConfig.speechSynthesisOutputFormat =
        sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
      const synth = new sdk.SpeechSynthesizer(synthConfig, null);

      synth.speakTextAsync(
        text,
        (result) => {
          const audioAt = Date.now() - started;
          synth.close();
          void reco.stopContinuousRecognitionAsync(() => reco.close());
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({ finalAt, audioAt, bytes: result.audioData.byteLength });
          } else {
            reject(new Error(result.errorDetails));
          }
        },
        (error) => {
          synth.close();
          reject(new Error(error));
        },
      );
    };

    reco.canceled = (_s, e) => {
      if (e.reason !== sdk.CancellationReason.Error) return;
      reject(new Error(e.errorDetails || "canceled"));
    };
    reco.startContinuousRecognitionAsync(() => {}, reject);
    setTimeout(() => reject(new Error("timeout")), 45000);
  });
}

/** Alternative: one call — the recognizer synthesizes as it translates. */
function fused(token) {
  return new Promise((resolve, reject) => {
    const config = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = SOURCE;
    config.addTargetLanguage(TARGET);
    // Documented constraint: the synthesizing event works with exactly one target language.
    config.voiceName = VOICE;
    config.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "350");

    const reco = new sdk.TranslationRecognizer(config, pushStream());
    const started = Date.now();
    let finalAt;
    let firstAudioAt;
    let bytes = 0;

    reco.recognized = (_s, e) => {
      if (e.result.reason === sdk.ResultReason.TranslatedSpeech && finalAt === undefined) {
        finalAt = Date.now() - started;
      }
    };

    reco.synthesizing = (_s, e) => {
      const audio = e.result.audio;
      if (!audio || audio.byteLength === 0) return;
      if (firstAudioAt === undefined) firstAudioAt = Date.now() - started;
      bytes += audio.byteLength;
    };

    reco.canceled = (_s, e) => {
      // EndOfStream is the normal way a push-stream session finishes; only a real error
      // should fail the trial.
      if (e.reason !== sdk.CancellationReason.Error) return;
      reject(
        new Error(
          `${sdk.CancellationErrorCode[e.errorCode] ?? e.errorCode}: ${e.errorDetails || "(no detail)"}`,
        ),
      );
    };
    reco.sessionStopped = () => {
      reco.close();
      if (firstAudioAt === undefined) {
        reject(new Error("no synthesized audio was produced"));
      } else {
        resolve({ finalAt, audioAt: firstAudioAt, bytes });
      }
    };
    reco.startContinuousRecognitionAsync(() => {}, reject);
    setTimeout(() => reject(new Error("timeout")), 45000);
  });
}

/**
 * Same as `chained`, but the synthesizer's connection is opened up front.
 *
 * Hypothesis: most of the chained path's extra cost is TLS + WebSocket setup on a cold
 * connection, not the extra round trip itself. If so, pre-warming recovers the latency
 * without the architectural change that switching to fused synthesis would require.
 */
function chainedPrewarmed(token, warm) {
  return new Promise((resolve, reject) => {
    const config = sdk.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    config.speechRecognitionLanguage = SOURCE;
    config.addTargetLanguage(TARGET);
    config.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "350");

    const reco = new sdk.TranslationRecognizer(config, pushStream());
    const started = Date.now();
    let finalAt;

    reco.recognized = (_s, e) => {
      if (e.result.reason !== sdk.ResultReason.TranslatedSpeech) return;
      const text = e.result.translations.get(TARGET);
      if (!text || finalAt !== undefined) return;
      finalAt = Date.now() - started;

      warm.synth.speakTextAsync(
        text,
        (result) => {
          const audioAt = Date.now() - started;
          void reco.stopContinuousRecognitionAsync(() => reco.close());
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve({ finalAt, audioAt, bytes: result.audioData.byteLength });
          } else {
            reject(new Error(result.errorDetails));
          }
        },
        (error) => reject(new Error(error)),
      );
    };

    reco.canceled = (_s, e) => {
      if (e.reason !== sdk.CancellationReason.Error) return;
      reject(new Error(e.errorDetails || "canceled"));
    };
    reco.startContinuousRecognitionAsync(() => {}, reject);
    setTimeout(() => reject(new Error("timeout")), 45000);
  });
}

/** Opens the synthesizer's websocket ahead of time and keeps it alive. */
function openWarmSynthesizer(token) {
  const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  config.speechSynthesisVoiceName = VOICE;
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
  const synth = new sdk.SpeechSynthesizer(config, null);
  const connection = sdk.Connection.fromSynthesizer(synth);
  connection.openConnection();
  return { synth, connection };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const token = await speechToken();
const results = { chained: [], "chained+warm": [], fused: [] };

const warm = openWarmSynthesizer(token);
// Give the pre-opened connection a moment to complete its handshake.
await new Promise((r) => setTimeout(r, 2000));

for (let trial = 1; trial <= TRIALS; trial++) {
  for (const [name, run] of [
    ["chained", () => chained(token)],
    ["chained+warm", () => chainedPrewarmed(token, warm)],
    ["fused", () => fused(token)],
  ]) {
    try {
      const r = await run();
      results[name].push(r);
      console.log(
        `trial ${trial}  ${name.padEnd(13)}  final ${String(r.finalAt).padStart(5)}ms  ` +
          `first audio ${String(r.audioAt).padStart(5)}ms  ${r.bytes} bytes`,
      );
    } catch (cause) {
      console.log(`trial ${trial}  ${name.padEnd(13)}  FAILED: ${cause.message}`);
    }
  }
}

warm.synth.close();

console.log("\n--- median time to first translated audio ---");
const summary = {};
for (const name of Object.keys(results)) {
  const audio = results[name].map((r) => r.audioAt);
  if (audio.length === 0) {
    console.log(`${name.padEnd(13)}  no successful runs`);
    continue;
  }
  summary[name] = median(audio);
  console.log(`${name.padEnd(13)}  ${summary[name]}ms   (n=${audio.length})`);
}

const base = summary["chained"];
if (base) {
  for (const name of ["chained+warm", "fused"]) {
    if (!summary[name]) continue;
    const delta = base - summary[name];
    console.log(
      `${name.padEnd(13)}  ${delta > 0 ? "-" : "+"}${Math.abs(delta)}ms vs chained ` +
        `(${Math.round((Math.abs(delta) / base) * 100)}%)`,
    );
  }
}
process.exit(0);
