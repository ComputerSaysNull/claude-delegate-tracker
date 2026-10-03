import { describe, expect, it } from "vitest";
import { titleFromTask } from "../../src/server/titles.ts";

describe("titleFromTask", () => {
  it("returns '(no task)' for non-string inputs", () => {
    expect(titleFromTask(undefined)).toBe("(no task)");
    expect(titleFromTask(null)).toBe("(no task)");
    expect(titleFromTask(42)).toBe("(no task)");
  });

  it("returns '(no task)' for blank strings", () => {
    expect(titleFromTask("")).toBe("(no task)");
    expect(titleFromTask("  \n \n")).toBe("(no task)");
  });

  it("skips leading blank lines and trims the first line", () => {
    expect(titleFromTask("\n  \n  hello  ")).toBe("hello");
  });

  it("returns exactly 60 characters unchanged", () => {
    const task = "a".repeat(60);
    expect(titleFromTask(task)).toBe(task);
  });

  it("cuts 61+ chars with a space at the last space in the first 60 and appends …", () => {
    const task = "hello world " + "x".repeat(50);
    const result = titleFromTask(task);
    expect(result.endsWith("\u2026")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toBe("hello world\u2026");
  });

  it("cuts 61+ chars with no space to 59 chars plus …", () => {
    const task = "a".repeat(61);
    const result = titleFromTask(task);
    expect(result).toBe("a".repeat(59) + "\u2026");
    expect(result.length).toBe(60);
  });

  it("uses only the first line of a multi-line task", () => {
    const task = "first line\nsecond line";
    expect(titleFromTask(task)).toBe("first line");
  });
});
