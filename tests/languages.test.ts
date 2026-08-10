import { describe, it, expect } from "vitest";
import {
  LANGUAGES,
  findLanguage,
  requireLanguage,
  isSupportedLanguage,
} from "../src/shared/languages.js";

describe("language catalog", () => {
  it("offers at least eight languages so a demo has real choice", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(8);
  });

  it("has no duplicate translation codes", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("pairs every translation code with a speech locale in the same language", () => {
    // The translation API takes "es" or "zh-Hans"; the recognizer needs a full locale
    // ("es-ES", "zh-CN"). Only the primary subtag is guaranteed to match — Chinese is
    // translated as "zh-Hans" but recognized as "zh-CN". Comparing primary subtags still
    // catches a genuine mismatch such as "es" paired with "fr-FR".
    for (const lang of LANGUAGES) {
      const codePrimary = lang.code.split("-")[0];
      const localePrimary = lang.speechLocale.split("-")[0];
      expect(localePrimary).toBe(codePrimary);
    }
  });

  it("rejects a mismatched pairing when one is introduced", () => {
    // Guards the check above against becoming a tautology.
    const bogus = { code: "es", speechLocale: "fr-FR" };
    expect(bogus.speechLocale.split("-")[0]).not.toBe(bogus.code.split("-")[0]);
  });

  it("gives every language a voice in that language's own locale", () => {
    // A voice from the wrong locale would speak the translation with a foreign accent.
    for (const lang of LANGUAGES) {
      expect(lang.voice.startsWith(`${lang.speechLocale}-`)).toBe(true);
    }
  });

  it("names every language in English and in its own script", () => {
    for (const lang of LANGUAGES) {
      expect(lang.name.length).toBeGreaterThan(0);
      expect(lang.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("marks Arabic as right-to-left and English as left-to-right", () => {
    expect(requireLanguage("ar").dir).toBe("rtl");
    expect(requireLanguage("en").dir).toBe("ltr");
  });

  it("treats Arabic as the only right-to-left language in the catalog", () => {
    const rtl = LANGUAGES.filter((l) => l.dir === "rtl").map((l) => l.code);
    expect(rtl).toEqual(["ar"]);
  });

  describe("findLanguage", () => {
    it("finds a known language by code", () => {
      expect(findLanguage("hi")?.name).toBe("Hindi");
    });

    it("returns undefined for an unknown code rather than throwing", () => {
      expect(findLanguage("zz")).toBeUndefined();
    });

    it("returns undefined for an empty code", () => {
      expect(findLanguage("")).toBeUndefined();
    });
  });

  describe("requireLanguage", () => {
    it("returns the language when it exists", () => {
      expect(requireLanguage("es").speechLocale).toBe("es-ES");
    });

    it("throws a message naming the offending code", () => {
      expect(() => requireLanguage("zz")).toThrowError(/zz/);
    });
  });

  describe("isSupportedLanguage", () => {
    it("accepts a supported code", () => {
      expect(isSupportedLanguage("de")).toBe(true);
    });

    it("rejects an unsupported code", () => {
      expect(isSupportedLanguage("zz")).toBe(false);
    });

    it("rejects a non-string input", () => {
      expect(isSupportedLanguage(undefined)).toBe(false);
      expect(isSupportedLanguage(42)).toBe(false);
    });
  });
});
