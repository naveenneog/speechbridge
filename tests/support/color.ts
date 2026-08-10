/**
 * OKLCH → sRGB → WCAG relative luminance.
 *
 * Test-only support code so the design tokens can be contrast-checked mechanically.
 * Follows the CSS Color 4 conversion: OKLab → LMS → linear sRGB → gamma-encoded sRGB.
 */

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Parses `oklch(0.7 0.15 74.6)`. Returns undefined for anything else. */
export function parseOklch(value: string): Oklch | undefined {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(value.trim());
  if (!match) return undefined;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function linearToSrgb(channel: number): number {
  const abs = Math.abs(channel);
  const sign = channel < 0 ? -1 : 1;
  return abs <= 0.0031308 ? channel * 12.92 : sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
}

/** Converts OKLCH to gamma-encoded sRGB in 0..1, clamped to the displayable gamut. */
export function oklchToSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lCube = l + 0.3963377774 * a + 0.2158037573 * b;
  const mCube = l - 0.1055613458 * a - 0.0638541728 * b;
  const sCube = l - 0.0894841775 * a - 1.291485548 * b;

  const lLin = lCube ** 3;
  const mLin = mCube ** 3;
  const sLin = sCube ** 3;

  const r = 4.0767416621 * lLin - 3.3077115913 * mLin + 0.2309699292 * sLin;
  const g = -1.2684380046 * lLin + 2.6097574011 * mLin - 0.3413193965 * sLin;
  const bl = -0.0041960863 * lLin - 0.7034186147 * mLin + 1.707614701 * sLin;

  return [
    Math.min(1, Math.max(0, linearToSrgb(r))),
    Math.min(1, Math.max(0, linearToSrgb(g))),
    Math.min(1, Math.max(0, linearToSrgb(bl))),
  ];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(srgb: [number, number, number]): number {
  const [r, g, b] = srgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two OKLCH colours, 1..21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(oklchToSrgb(a));
  const lb = relativeLuminance(oklchToSrgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
