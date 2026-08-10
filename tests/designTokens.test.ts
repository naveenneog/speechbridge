/**
 * The design bar, enforced by the build.
 *
 * Low-contrast muted text on a dark surface is the most common way a good-looking
 * interface becomes unreadable in a bright room — and it is invisible to the person who
 * chose the colour. These tests read the real stylesheet, so a token cannot be nudged
 * darker without the build objecting.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, parseOklch, type Oklch } from "./support/color.js";

const css = readFileSync(resolve(process.cwd(), "src/client/styles.css"), "utf8");

function token(name: string): Oklch {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) throw new Error(`Design token --${name} is not defined in styles.css`);
  const parsed = parseOklch(match[1]);
  if (!parsed) throw new Error(`Design token --${name} is not a plain oklch() value: ${match[1]}`);
  return parsed;
}

describe("colour conversion", () => {
  it("computes a known contrast ratio — black on white is 21:1", () => {
    const white = { l: 1, c: 0, h: 0 };
    const black = { l: 0, c: 0, h: 0 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  it("reports 1:1 for a colour against itself", () => {
    const colour = { l: 0.5, c: 0.1, h: 200 };
    expect(contrastRatio(colour, colour)).toBeCloseTo(1, 5);
  });
});

describe("design tokens", () => {
  it("gives body text at least 7:1 against the background", () => {
    expect(contrastRatio(token("ink"), token("bg"))).toBeGreaterThanOrEqual(7);
  });

  it("gives secondary text at least 4.5:1 against the background", () => {
    // Muted text carries real content here (original transcripts, hints), so it is held
    // to the body-text bar, not the 3:1 large-text one.
    expect(contrastRatio(token("muted"), token("bg"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps secondary text readable on raised surfaces too", () => {
    expect(contrastRatio(token("muted"), token("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("muted"), token("surface-raised"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body text readable on every surface", () => {
    for (const surface of ["bg", "surface", "surface-raised"]) {
      expect(contrastRatio(token("ink"), token(surface))).toBeGreaterThanOrEqual(7);
    }
  });

  it("makes the speaker colour legible as text on dark surfaces", () => {
    expect(contrastRatio(token("primary"), token("bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("primary"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the listener colour legible as text on dark surfaces", () => {
    expect(contrastRatio(token("accent"), token("bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("accent"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the two channel colours clearly distinguishable", () => {
    // If amber and cyan read alike, the interface loses its only "whose turn is it" signal.
    expect(contrastRatio(token("primary"), token("accent"))).toBeGreaterThanOrEqual(1.7);
  });

  it("makes error text legible", () => {
    expect(contrastRatio(token("danger"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the success indicator legible", () => {
    expect(contrastRatio(token("success"), token("bg"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps borders visible without being louder than text", () => {
    const lineOnSurface = contrastRatio(token("line"), token("surface"));
    expect(lineOnSurface).toBeGreaterThanOrEqual(1.2);
    expect(lineOnSurface).toBeLessThan(contrastRatio(token("ink"), token("surface")));
  });

  it("keeps the primary chroma below the perceptual glow threshold", () => {
    expect(token("primary").c).toBeLessThanOrEqual(0.23);
    expect(token("accent").c).toBeLessThanOrEqual(0.23);
  });

  it("keeps surfaces pure neutral, with no hidden warm tint", () => {
    // A warm-tinted near-black plus a warm primary is the saturated AI default.
    for (const surface of ["bg", "surface", "surface-raised"]) {
      expect(token(surface).c).toBe(0);
    }
  });
});

describe("stylesheet discipline", () => {
  it("respects prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("uses no hex colours — the palette is OKLCH throughout", () => {
    const hex = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hex).toEqual([]);
  });

  it("uses no arbitrary z-index values", () => {
    const zIndexes = css.match(/z-index:\s*(\d+)/g) ?? [];
    expect(zIndexes).toEqual([]);
  });

  it("keeps card corners under control", () => {
    // Cards top out at 16px; 24-40px is the over-rounded tell. A full pill (999px) is a
    // different, legitimate idiom for badges, so it is named as the one exception.
    const PILL = 999;
    const radii = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1]));
    const overRounded = radii.filter((r) => r > 16 && r !== PILL);
    expect(overRounded).toEqual([]);
  });

  it("has no decorative side-stripe borders", () => {
    expect(css).not.toMatch(/border-(left|right):\s*(?![01]px)\d+px/);
  });

  it("has no gradient text", () => {
    expect(css).not.toMatch(/background-clip:\s*text/);
  });
});
