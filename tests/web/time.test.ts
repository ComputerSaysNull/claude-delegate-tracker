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
    expect(localTime(AT)).toBe("17:30");
    expect(localDateTime(AT)).toMatch(/ 17:30$/);
    expect(localTime(AT)).not.toMatch(/12:00/);
  });

  it("follows the zone, not a fixed offset (UTC−7 here)", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(localTime(AT)).toBe("05:00");
  });

  it("uses a 24-hour clock: 7 PM is 19:00, 7 AM is 07:00", () => {
    process.env.TZ = "UTC";
    expect(localTime("2026-11-12T19:00:00.000Z")).toBe("19:00");
    expect(localTime("2026-11-12T07:05:00.000Z")).toBe("07:05");
  });

  it("writes a date as day and short month, the year only when it is not this year", () => {
    process.env.TZ = "UTC";
    const now = new Date("2026-12-01T00:00:00.000Z");
    expect(localDateTime("2026-11-12T19:00:00.000Z", now)).toBe("12 Nov 19:00");
    expect(localDateTime("2026-10-03T09:00:00.000Z", now)).toBe("3 Oct 09:00");
    expect(localDateTime("2025-11-12T19:00:00.000Z", now)).toBe("12 Nov 2025 19:00");
  });

  it("takes the year from the viewer's zone, not from UTC", () => {
    process.env.TZ = "Asia/Kolkata";
    // 31 Dec 2025 20:00 UTC is already 1 Jan 2026 in Kolkata.
    expect(localDateTime("2025-12-31T20:00:00.000Z", new Date("2026-06-01T00:00:00.000Z"))).toBe("1 Jan 01:30");
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
