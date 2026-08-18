/**
 * Decides whether a catalog voice is actually usable, from evidence rather than from a listing.
 *
 * Why this exists: on 2026-08-18 the `eastus2` TTS `voices/list` endpoint advertised
 * `en-IN-Diya:DragonHDLatestNeural`, but every synthesis attempt against that region returned a
 * bare HTTP 503 with an empty body (0 ok / 8 attempts). The same voice, same SSML and same token
 * flow synthesised 4/4 against `centralindia`. The catalogue and the synthesiser disagreed.
 *
 * The consequence for us is narrow but important: asking `voices/list` "does this voice exist?"
 * is not a test of availability. Only synthesising audio is. This module encodes that — a voice
 * is a problem unless we hold a successful probe carrying a plausible amount of audio, and an
 * absent probe counts as unproven, never as healthy.
 *
 * See docs/adr/0014-voice-availability-is-proven-by-synthesis.md and UNKNOWNS U-14.
 */

/** Result of one real synthesis request for a single voice. */
export type SynthesisProbe =
  | { readonly status: "ok"; readonly bytes: number }
  | { readonly status: "failed"; readonly httpStatus: number };

/** Evidence gathered from the live service, against which the catalog is judged. */
export interface AvailabilityEvidence {
  /** Voice `shortName`s the region's `voices/list` endpoint advertises. */
  readonly listedVoices: ReadonlySet<string>;
  /** Valid translation target codes from the Translator `languages` endpoint. */
  readonly translationTargets: ReadonlySet<string>;
  /** One probe per voice we attempted to synthesise. A missing entry means "never probed". */
  readonly probes: ReadonlyMap<string, SynthesisProbe>;
}

/** The subset of a catalog language this audit needs. */
export interface AuditableLanguage {
  readonly code: string;
  readonly voice: string;
}

/**
 * Smallest response we will accept as real audio. A short spoken phrase at 24 kHz runs to tens of
 * kilobytes, so anything under a kilobyte is an empty or truncated body rather than a working
 * voice — and a 200 carrying no audio must not read as success.
 */
export const MIN_AUDIO_BYTES = 1024;

export function auditVoiceAvailability(
  languages: readonly AuditableLanguage[],
  evidence: AvailabilityEvidence,
): string[] {
  const problems: string[] = [];

  for (const lang of languages) {
    if (!evidence.translationTargets.has(lang.code)) {
      problems.push(`${lang.code}: not a valid translation target code`);
    }

    if (!evidence.listedVoices.has(lang.voice)) {
      problems.push(`${lang.code}: voice "${lang.voice}" is not offered in this region`);
      continue;
    }

    const probe = evidence.probes.get(lang.voice);

    if (probe === undefined) {
      problems.push(
        `${lang.code}: voice "${lang.voice}" is listed but availability was not proven — no synthesis was attempted`,
      );
      continue;
    }

    if (probe.status === "failed") {
      problems.push(
        `${lang.code}: voice "${lang.voice}" is listed but will not synthesise here — HTTP ${probe.httpStatus}. ` +
          `The catalogue advertises it; the synthesiser refuses it. Try another region or another voice.`,
      );
      continue;
    }

    if (probe.bytes < MIN_AUDIO_BYTES) {
      problems.push(
        `${lang.code}: voice "${lang.voice}" returned only ${probe.bytes} bytes — too small to be real audio, so availability is not proven`,
      );
    }
  }

  return problems;
}
