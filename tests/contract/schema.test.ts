// Proves the vendored transcript schema compiles, accepts every sample line, covers all event kinds, and rejects tampered events.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const samplesDir = join(root, "contract", "samples");
const schema = JSON.parse(readFileSync(join(root, "contract", "transcript.schema.json"), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);
const sampleFiles = readdirSync(samplesDir).filter((f) => f.endsWith(".jsonl"));

const KINDS = ["start", "priced", "tools", "partial", "alive", "waiting", "turn", "end"];

const allEvents = () =>
  sampleFiles.flatMap((f) =>
    readFileSync(join(samplesDir, f), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l, i) => ({ file: f, line: i + 1, event: JSON.parse(l) })),
  );

describe("transcript schema", () => {
  it("compiles", () => {
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it("has at least one sample and a non-empty VERSION", () => {
    expect(sampleFiles.length).toBeGreaterThan(0);
    const version = readFileSync(join(root, "contract", "VERSION"), "utf8");
    expect(version.trim().length).toBeGreaterThan(0);
  });

  it.each(sampleFiles)("%s: every non-blank line is a valid event", (f) => {
    readFileSync(join(samplesDir, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.trim() === "") return;
        let evt: unknown;
        try {
          evt = JSON.parse(line);
        } catch (err) {
          throw new Error(`${f} line ${i + 1}: invalid JSON`, { cause: err });
        }
        if (!validate(evt)) {
          throw new Error(`${f} line ${i + 1} fails schema: ${JSON.stringify(validate.errors)}`);
        }
      });
  });

  it("covers every expected event kind", () => {
    const kinds = new Set(allEvents().map((x) => x.event.t));
    for (const k of KINDS) expect(kinds.has(k)).toBe(true);
  });

  it("rejects a start event whose t is numeric", () => {
    const start = allEvents().find((x) => x.event.t === "start");
    expect(start).toBeDefined();
    expect(validate({ ...start!.event, t: 42 })).toBe(false);
  });

  // The tracker reads start.mcp_task (format 1.12), so the vendored schema must define it as a boolean.
  it("defines start.mcp_task as a boolean", () => {
    const start = allEvents().find((x) => x.event.t === "start");
    expect(start).toBeDefined();
    expect(validate({ ...start!.event, mcp_task: true })).toBe(true);
    expect(validate({ ...start!.event, mcp_task: false })).toBe(true);
    expect(validate({ ...start!.event, mcp_task: "yes" })).toBe(false);
  });

  // The tracker reads tool_call.result_images and files_read[].images (format 1.13), so the
  // vendored schema must define both as whole numbers.
  it("defines a tool call's result_images as an integer", () => {
    const turn = allEvents().find((x) => x.event.t === "turn" && Array.isArray(x.event.tool_calls) && x.event.tool_calls.length > 0);
    expect(turn).toBeDefined();
    const withImages = (v: unknown) => {
      const [first, ...rest] = turn!.event.tool_calls as Record<string, unknown>[];
      return { ...turn!.event, tool_calls: [{ ...first, result_images: v }, ...rest] };
    };
    expect(validate(withImages(8))).toBe(true);
    expect(validate(withImages("8"))).toBe(false);
  });

  it("defines a prefetched file's images as an integer", () => {
    const start = allEvents().find((x) => x.event.t === "start" && Array.isArray(x.event.files_read) && x.event.files_read.length > 0);
    expect(start).toBeDefined();
    const withImages = (v: unknown) => {
      const [first, ...rest] = start!.event.files_read as Record<string, unknown>[];
      return { ...start!.event, files_read: [{ ...first, images: v }, ...rest] };
    };
    expect(validate(withImages(8))).toBe(true);
    expect(validate(withImages("8"))).toBe(false);
  });

  it.each(["t", "at"])("rejects an event without its required %s", (field) => {
    const event: Record<string, unknown> = { ...allEvents()[0].event };
    expect(validate(event)).toBe(true);
    delete event[field];
    expect(validate(event)).toBe(false);
  });
});
