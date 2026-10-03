// Streams carry UTC; the page shows local time everywhere, through one formatter.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localDateTime, localTime } from "../../src/web/time.ts";

const AT = "2026-10-01T12:00:00.000Z";
const WEB = join(import.meta.dirname, "..", "..", "src", "web");
const savedTz = process.env.TZ;

describe("local time", () => {
  afterEach(() => {
    process.env.TZ = savedTz;
  });

  it("shows a UTC time in the viewer's zone (UTC+5:30 here), never as UTC", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(localTime(AT)).toMatch(/5:30/);
    expect(localDateTime(AT)).toMatch(/5:30/);
    expect(localTime(AT)).not.toMatch(/12:00/);
  });

  it("follows the zone, not a fixed offset (UTC−7 here)", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(localTime(AT)).toMatch(/5:00/);
  });

  it("shows a dash for no time", () => {
    expect(localTime(null)).toBe("—");
    expect(localDateTime(null)).toBe("—");
  });

  it("is the only place the page formats a time", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(WEB)) {
      if (!/\.(ts|tsx)$/.test(file) || file === "time.ts") continue;
      const text = readFileSync(join(WEB, file), "utf8");
      if (/toLocale(Date|Time)String\(|new Date\([^)]*\)\.toLocaleString\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

// Tailwind colour utilities that need a dark-mode partner in the same class string.
const COLOUR = /(?<![\w:-])(bg|text|border)-(slate|gray|red|amber|green|blue|orange|white|black)(-\d{2,3})?\b/g;

function missingDarkVariants(source: string): string[] {
  const missing: string[] = [];
  for (const m of source.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)) {
    const classes = m[1] ?? m[2];
    for (const c of classes.matchAll(COLOUR)) {
      if (!new RegExp(`(^|\\s)dark:${c[1]}-`).test(classes)) missing.push(`${c[0]} in "${classes}"`);
    }
  }
  return missing;
}

describe("dark and light themes", () => {
  it("every colour on the page has a dark-mode variant", () => {
    const missing: string[] = [];
    for (const file of readdirSync(WEB)) {
      if (!/\.(tsx|css)$/.test(file)) continue;
      for (const m of missingDarkVariants(readFileSync(join(WEB, file), "utf8"))) missing.push(`${file}: ${m}`);
    }
    expect(missing).toEqual([]);
  });

  it("the check fires on a colour without its dark variant", () => {
    expect(missingDarkVariants('className="text-red-600"')).toHaveLength(1);
    expect(missingDarkVariants('className="text-red-600 dark:text-red-400"')).toHaveLength(0);
    expect(missingDarkVariants('className="bg-white text-slate-900 dark:bg-slate-950"')).toHaveLength(1);
  });
});
