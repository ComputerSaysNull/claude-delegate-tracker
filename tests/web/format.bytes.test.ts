// Byte counts written short for the figures list: "512 B", "1.5 KB", "5.7 GB". The unit is
// fixed by the spec (divide by 1024, one decimal below 100, whole at 100 and above).
import { describe, expect, it } from "vitest";
import { bytes } from "../../src/web/format.ts";

describe("bytes", () => {
  it("keeps a count under a kilobyte as whole bytes, including zero", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(0)).toBe("0 B");
  });

  it("divides by 1024 into KB, MB, GB and TB", () => {
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(5.7 * 1024 ** 3)).toBe("5.7 GB");
  });

  it("writes a whole number with no decimal at 100 and above", () => {
    expect(bytes(150 * 1024)).toBe("150 KB");
  });

  it("rolls a whole-byte rounding that reaches 1024 up into kilobytes", () => {
    expect(bytes(1023.6)).toBe("1.0 KB");
  });

  it("rolls a rounding that reaches 1024 up into the next unit", () => {
    expect(bytes(1023.95 * 1024)).toBe("1.0 MB");
  });
});
