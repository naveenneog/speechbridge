/**
 * The languages this demo can speak, and the voice each one is spoken with.
 *
 * Every `voice` and every `code` in this file was verified against the live service on
 * 2026-08-10 — voices via the TTS `voices/list` endpoint, translation codes via the
 * Translator `languages` endpoint. `npm run verify:voices` re-checks both and is the
 * detector that stops this list drifting from reality (docs/UNKNOWNS.md, U-10).
 */

export type TextDirection = "ltr" | "rtl";

export interface Language {
  /** Translation target code used by the Speech translation API, e.g. "es", "zh-Hans". */
  readonly code: string;
  /** Full recognition locale used by the recognizer, e.g. "es-ES", "zh-CN". */
  readonly speechLocale: string;
  /** Name in English, for the language picker. */
  readonly name: string;
  /** Name in its own script, so a speaker can find their language without reading English. */
  readonly nativeName: string;
  /** Verified neural voice `shortName` used to speak translations into this language. */
  readonly voice: string;
  /** Writing direction, so captions render correctly. */
  readonly dir: TextDirection;
}

export const LANGUAGES: readonly Language[] = [
  { code: "en", speechLocale: "en-US", name: "English", nativeName: "English", voice: "en-US-AvaMultilingualNeural", dir: "ltr" },
  { code: "hi", speechLocale: "hi-IN", name: "Hindi", nativeName: "हिन्दी", voice: "hi-IN-AnanyaNeural", dir: "ltr" },
  { code: "kn", speechLocale: "kn-IN", name: "Kannada", nativeName: "ಕನ್ನಡ", voice: "kn-IN-SapnaNeural", dir: "ltr" },
  { code: "ta", speechLocale: "ta-IN", name: "Tamil", nativeName: "தமிழ்", voice: "ta-IN-PallaviNeural", dir: "ltr" },
  { code: "te", speechLocale: "te-IN", name: "Telugu", nativeName: "తెలుగు", voice: "te-IN-ShrutiNeural", dir: "ltr" },
  { code: "mr", speechLocale: "mr-IN", name: "Marathi", nativeName: "मराठी", voice: "mr-IN-AarohiNeural", dir: "ltr" },
  { code: "es", speechLocale: "es-ES", name: "Spanish", nativeName: "Español", voice: "es-ES-IsidoraMultilingualNeural", dir: "ltr" },
  { code: "fr", speechLocale: "fr-FR", name: "French", nativeName: "Français", voice: "fr-FR-VivienneMultilingualNeural", dir: "ltr" },
  { code: "de", speechLocale: "de-DE", name: "German", nativeName: "Deutsch", voice: "de-DE-SeraphinaMultilingualNeural", dir: "ltr" },
  { code: "it", speechLocale: "it-IT", name: "Italian", nativeName: "Italiano", voice: "it-IT-IsabellaMultilingualNeural", dir: "ltr" },
  { code: "pt", speechLocale: "pt-BR", name: "Portuguese", nativeName: "Português", voice: "pt-BR-ThalitaMultilingualNeural", dir: "ltr" },
  { code: "ja", speechLocale: "ja-JP", name: "Japanese", nativeName: "日本語", voice: "ja-JP-NanamiNeural", dir: "ltr" },
  { code: "ko", speechLocale: "ko-KR", name: "Korean", nativeName: "한국어", voice: "ko-KR-HyunsuMultilingualNeural", dir: "ltr" },
  { code: "zh-Hans", speechLocale: "zh-CN", name: "Chinese", nativeName: "中文", voice: "zh-CN-XiaoxiaoMultilingualNeural", dir: "ltr" },
  { code: "ru", speechLocale: "ru-RU", name: "Russian", nativeName: "Русский", voice: "ru-RU-SvetlanaNeural", dir: "ltr" },
  { code: "ar", speechLocale: "ar-EG", name: "Arabic", nativeName: "العربية", voice: "ar-EG-SalmaNeural", dir: "rtl" },
];

const BY_CODE: ReadonlyMap<string, Language> = new Map(LANGUAGES.map((l) => [l.code, l]));

/** The language for `code`, or `undefined` if it is not one we support. */
export function findLanguage(code: string): Language | undefined {
  return BY_CODE.get(code);
}

/** The language for `code`, or a thrown error naming the code we could not resolve. */
export function requireLanguage(code: string): Language {
  const found = BY_CODE.get(code);
  if (!found) {
    throw new Error(`Unsupported language code: "${code}"`);
  }
  return found;
}

/** Narrows unknown input — used to validate anything arriving from a URL or a request. */
export function isSupportedLanguage(code: unknown): code is string {
  return typeof code === "string" && BY_CODE.has(code);
}
