// One set of named colour tokens, light and dark, read from index.css: text on them is
// readable, nothing on the page picks its own colour, and the fonts come from the tracker.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STATES } from "../../src/server/streams.ts";
import { STATE_ICON } from "../../src/web/states.tsx";

const WEB = join(import.meta.dirname, "..", "..", "src", "web");
const CSS = readFileSync(join(WEB, "index.css"), "utf8");

type Tokens = Record<string, string>;

// The custom properties of the first block that `opener` starts.
export function tokensIn(css: string, opener: RegExp): Tokens {
  const start = css.search(opener);
  if (start < 0) return {};
  const body = css.slice(css.indexOf("{", start) + 1);
  let depth = 1, end = 0;
  for (; end < body.length && depth > 0; end++) {
    if (body[end] === "{") depth++;
    else if (body[end] === "}") depth--;
  }
  const out: Tokens = {};
  for (const m of body.slice(0, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const LIGHT = tokensIn(CSS, /^:root\s*\{/m);
const DARK = { ...LIGHT, ...tokensIn(CSS.slice(CSS.search(/prefers-color-scheme:\s*dark/)), /:root\s*\{/) };

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lum = ([r, g, b]: [number, number, number]): number => {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// `fg` mixed over `bg` at `share`, as the badges and card tints draw it.
function mix(fg: string, bg: string, share: number): string {
  const [f, b] = [rgb(fg), rgb(bg)];
  return "#" + f.map((c, i) => Math.round(c * share + b[i] * (1 - share)).toString(16).padStart(2, "0")).join("");
}

// Text tokens and the grounds each one is drawn on.
const TEXT = ["text", "muted", "accent", "warn", "hot", ...STATES.map((s) => `state-${s.replace(" ", "-")}`)];

function failures(t: Tokens): string[] {
  const out: string[] = [];
  const grounds: Record<string, string> = { page: t.page, card: t.card };
  for (const name of TEXT) {
    if (t[name] === undefined) { out.push(`--${name} is missing`); continue; }
    const on = { ...grounds, [`its own tint`]: mix(t[name], t.card, 0.14) };
    for (const [g, hex] of Object.entries(on)) {
      const c = contrast(t[name], hex);
      if (c < 4.5) out.push(`--${name} on ${g}: ${c.toFixed(2)}:1`);
    }
  }
  return out;
}

// The card's tint is the state's colour over the card at this share, as CARD_TINT draws it;
// text and muted must stay readable on it.
const CARD_SHARE: Record<string, number> = {
  live: 0.12,
  asking: 0.12,
  queued: 0.1,
  quiet: 0.08,
  ok: 0.08,
  failed: 0.08,
  stopped: 0.08,
  "timed out": 0.08,
  "cut off": 0.08,
};

function tintFailures(t: Tokens): string[] {
  const out: string[] = [];
  for (const s of STATES) {
    const stateVar = `state-${s.replace(" ", "-")}`;
    if (t[stateVar] === undefined) { out.push(`--${stateVar} is missing`); continue; }
    const tint = mix(t[stateVar], t.card, CARD_SHARE[s]);
    for (const name of ["text", "muted"]) {
      const c = contrast(t[name], tint);
      if (c < 4.5) out.push(`--${name} on the ${s} tint: ${c.toFixed(2)}:1`);
    }
  }
  return out;
}

describe("colour tokens", () => {
  it("defines the light and the dark set", () => {
    expect(Object.keys(LIGHT).length).toBeGreaterThan(10);
    expect(DARK.page).not.toBe(LIGHT.page);
  });

  it("text is at least 4.5:1 on the page, a card and its own tint, in the light theme", () => {
    expect(failures(LIGHT)).toEqual([]);
  });

  it("text is at least 4.5:1 on the page, a card and its own tint, in the dark theme", () => {
    expect(failures(DARK)).toEqual([]);
  });

  it("the check fires on a token too light to read", () => {
    expect(failures({ ...LIGHT, muted: "#c5ccd6" })).toContain(`--muted on card: ${contrast("#c5ccd6", LIGHT.card).toFixed(2)}:1`);
    expect(failures({ ...LIGHT, muted: undefined as unknown as string })).toContain("--muted is missing");
  });

  it("the light card is not pure white and differs from the page", () => {
    expect(LIGHT.card).not.toBe("#ffffff");
    expect(LIGHT.card).not.toBe(LIGHT.page);
  });

  it("text and muted are at least 4.5:1 on every state's card tint, in the light theme", () => {
    expect(tintFailures(LIGHT)).toEqual([]);
  });

  it("text and muted are at least 4.5:1 on every state's card tint, in the dark theme", () => {
    expect(tintFailures(DARK)).toEqual([]);
  });
});

// A colour picked by the page itself rather than taken from a token.
const OWN_COLOUR = /(?<![\w:-])(?:bg|text|border|ring|fill|stroke|placeholder)-(?:slate|gray|zinc|red|amber|green|blue|orange|yellow|white|black)(?:-\d{2,3})?\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

function ownColours(source: string): string[] {
  return [...source.matchAll(OWN_COLOUR)].map((m) => m[0]);
}

describe("every colour comes from a token", () => {
  it("no file in src/web but index.css names a colour of its own", () => {
    const found: string[] = [];
    for (const file of readdirSync(WEB)) {
      if (!/\.(ts|tsx|css|html)$/.test(file) || file === "index.css") continue;
      for (const c of ownColours(readFileSync(join(WEB, file), "utf8"))) found.push(`${file}: ${c}`);
    }
    expect(found).toEqual([]);
  });

  it("index.css names colours only inside its token blocks", () => {
    const outside = CSS.replace(/:root\s*\{[^}]*\}/g, "");
    expect(ownColours(outside)).toEqual([]);
  });

  it("the check fires on a palette class and on a hex literal", () => {
    expect(ownColours('className="text-red-600 bg-white"')).toEqual(["text-red-600", "bg-white"]);
    expect(ownColours('stroke: "#64748b"')).toEqual(["#64748b"]);
    expect(ownColours('className="text-muted bg-card"')).toEqual([]);
  });
});

// A request to another host for a font: a stylesheet link, an @import or a url().
const OUTSIDE_FONT = /https?:\/\/[^\s"')]*(?:font|typekit)/i;

describe("fonts", () => {
  it("IBM Plex Sans and Mono are the page's fonts", () => {
    expect(CSS).toMatch(/--font-sans:\s*"IBM Plex Sans"/);
    expect(CSS).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
  });

  it("are bundled from the installed packages, so the tracker serves them itself", () => {
    const main = readFileSync(join(WEB, "main.tsx"), "utf8");
    expect(main).toMatch(/@fontsource\/ibm-plex-sans/);
    expect(main).toMatch(/@fontsource\/ibm-plex-mono/);
  });

  it("nothing asks another host for a font", () => {
    for (const file of readdirSync(WEB)) {
      if (!/\.(ts|tsx|css|html)$/.test(file)) continue;
      expect(readFileSync(join(WEB, file), "utf8"), file).not.toMatch(OUTSIDE_FONT);
    }
  });

  it("the check fires on an outside font link", () => {
    expect('<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans">').toMatch(OUTSIDE_FONT);
    expect('@import url("https://use.typekit.net/abc.css");').toMatch(OUTSIDE_FONT);
  });
});

describe("state icons", () => {
  it("every state has its own icon", () => {
    for (const s of STATES) expect(STATE_ICON[s], s).toBeDefined();
    expect(new Set(STATES.map((s) => STATE_ICON[s])).size).toBe(STATES.length);
  });
});

// Tailwind's reset gives a button the arrow cursor, so a tool row or a fold did not look
// clickable. One base rule gives everything clickable the hand.
describe("pointer", () => {
  it("gives buttons, folds and other clickable controls the hand cursor", () => {
    const rule = /([^{}]+)\{[^{}]*cursor:\s*pointer[^{}]*\}/.exec(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));
    expect(rule, "a cursor: pointer rule in index.css").not.toBeNull();
    const selectors = rule![1].split(",").map((s) => s.trim());
    for (const wanted of ["button:not(:disabled)", "summary", "[role=\"button\"]", "select", "label"]) {
      expect(selectors).toContain(wanted);
    }
  });
});
