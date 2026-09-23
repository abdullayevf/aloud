import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.x relative luminance.
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Vitest does not serve this file under a file: URL, so resolve from the
// project root rather than from import.meta.url.
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const token = (name: string): string => {
  const found = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!found) throw new Error(`token --color-${name} is missing from app/globals.css`);
  return found[1];
};

describe("design tokens", () => {
  // Captions are the accessibility surface of this product, so AAA, not AA.
  it("puts caption text at AAA against both the page and a raised surface", () => {
    expect(contrast(token("ink"), token("paper"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("ink"), token("surface"))).toBeGreaterThanOrEqual(7);
  });

  // WCAG 2.1 SC 1.4.11. The borders this replaces measured 1.4:1 — the
  // "borders the same colour as everything" defect, stated as a number.
  it("puts every component boundary at 3:1, the non-text contrast floor", () => {
    expect(contrast(token("line"), token("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("line"), token("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps secondary and muted text readable on both the page and a surface", () => {
    expect(contrast(token("dim"), token("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("mute"), token("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("mute"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every status colour readable on the page and on a surface", () => {
    for (const status of ["exact", "altered", "cut", "danger"]) {
      expect(contrast(token(status), token("paper"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(status), token("surface"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps paper legible as the text colour of a filled status chip", () => {
    expect(contrast(token("paper"), token("altered"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("paper"), token("exact"))).toBeGreaterThanOrEqual(4.5);
  });

  it("does not hardcode a font-family on body — layout.tsx owns the font", () => {
    expect(css).not.toMatch(/font-family:\s*Arial/i);
  });
});
