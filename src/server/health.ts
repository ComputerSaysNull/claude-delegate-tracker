// The health report: what the page should warn about, as ready-to-show banners.
// Rules: docs/ARCHITECTURE.md "What the backend does" (Report health) and "When something fails".
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ModelFigures } from "./metrics.ts";
import type { NodeFigures } from "./nodes.ts";
import type { ListResponse } from "./poller.ts";
import { KNOWN_MAJOR } from "./streams.ts";

export interface Banner {
  level: "error" | "warning";
  text: string;
}

export interface Health {
  checkedAt: string;
  transcriptFolder: { configured: boolean; readable: boolean };
  clockSkewSeconds: number | null;
  banners: Banner[]; // errors first, then warnings, in the order of the rules below
}

export interface HealthInput {
  folderConfigured: boolean;
  list: ListResponse;
  retryInSeconds: number | null;    // when the folder is unreadable: the wait before the next try
  clockSkewSeconds: number | null;  // now − at on the freshest new line, whole seconds; null before any
  readIntervalSeconds: number;      // a fresh line is at most this old, so this much lag is not skew
  model: ModelFigures;
  nodes: NodeFigures[];
}

export const SKEW_LIMIT_SECONDS = 5;

// "<n> <noun>", singular when n is 1 ("1 event", "1 stream name", "1 line").
function count(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

// Banners, in this order (exact texts; `n` pluralises "event"/"events" and so on):
//  error   TRANSCRIPT_DIR is not set, so there is nothing to list.
//  error   The transcript folder can't be read; showing the last known list. Next try in <n>s.
//          (the last sentence only when retryInSeconds is not null; never when the folder is not set)
//  error   Node <name> was refused: its host key does not match the pinned one.   (per node)
//  warning The model server can't be reached.                (status "unreachable")
//  warning The model server has no /metrics (404).           (status "not available")
//  warning Node <name> can't be reached.                     (per node, status "unreachable")
//  warning Contract format <f>[, <f>…] is newer than this tracker knows (major <KNOWN_MAJOR>); those streams are shown as best they can be.
//          (distinct rows[].unknownFormat values, in first-seen order)
//  warning 1 event did not match the contract's schema; it is still shown. / <n> events … ; they are still shown.
//  warning 1 stream name lacks the timestamp prefix; it sorts last. / <n> stream names lack the timestamp prefix; they sort last.
//  warning 1 line was not JSON and was skipped. / <n> lines were not JSON and were skipped.
//  warning The WSL clock and this machine's clock differ by about <|s|>s; ages and times are off by that much.
//          (when clockSkewSeconds < −SKEW_LIMIT_SECONDS, or > readIntervalSeconds + SKEW_LIMIT_SECONDS)
export function buildHealth(input: HealthInput, now: Date): Health {
  const { folderConfigured, list, model, nodes, clockSkewSeconds, retryInSeconds, readIntervalSeconds } = input;
  const banners: Banner[] = [];

  if (!folderConfigured) {
    banners.push({ level: "error", text: "TRANSCRIPT_DIR is not set, so there is nothing to list." });
  }
  if (folderConfigured && !list.folderReadable) {
    const retry = retryInSeconds === null ? "" : ` Next try in ${retryInSeconds}s.`;
    banners.push({ level: "error", text: `The transcript folder can't be read; showing the last known list.${retry}` });
  }
  for (const node of nodes) {
    if (node.status === "host key refused") {
      banners.push({ level: "error", text: `Node ${node.name} was refused: its host key does not match the pinned one.` });
    }
  }

  if (model.status === "unreachable") {
    banners.push({ level: "warning", text: "The model server can't be reached." });
  }
  if (model.status === "not available") {
    banners.push({ level: "warning", text: "The model server has no /metrics (404)." });
  }
  for (const node of nodes) {
    if (node.status === "unreachable") {
      banners.push({ level: "warning", text: `Node ${node.name} can't be reached.` });
    }
  }

  const formats: string[] = [];
  for (const row of list.rows) {
    if (row.unknownFormat !== null && !formats.includes(row.unknownFormat)) formats.push(row.unknownFormat);
  }
  if (formats.length > 0) {
    banners.push({
      level: "warning",
      text: `Contract format ${formats.join(", ")} is newer than this tracker knows (major ${KNOWN_MAJOR}); those streams are shown as best they can be.`,
    });
  }

  const schemaFailures = list.schemaFailures;
  if (schemaFailures > 0) {
    const rest = schemaFailures === 1 ? "it is still shown." : "they are still shown.";
    banners.push({ level: "warning", text: `${count(schemaFailures, "event")} did not match the contract's schema; ${rest}` });
  }
  const unstamped = list.unstamped;
  if (unstamped > 0) {
    const verb = unstamped === 1 ? "lacks" : "lack";
    const rest = unstamped === 1 ? "it sorts last." : "they sort last.";
    banners.push({ level: "warning", text: `${count(unstamped, "stream name")} ${verb} the timestamp prefix; ${rest}` });
  }
  const badLines = list.badLines;
  if (badLines > 0) {
    const was = badLines === 1 ? "was" : "were";
    banners.push({ level: "warning", text: `${count(badLines, "line")} ${was} not JSON and ${was} skipped.` });
  }

  if (clockSkewSeconds !== null && (clockSkewSeconds < -SKEW_LIMIT_SECONDS || clockSkewSeconds > readIntervalSeconds + SKEW_LIMIT_SECONDS)) {
    banners.push({
      level: "warning",
      text: `The WSL clock and this machine's clock differ by about ${Math.round(Math.abs(clockSkewSeconds))}s; ages and times are off by that much.`,
    });
  }

  return {
    checkedAt: now.toISOString(),
    transcriptFolder: { configured: folderConfigured, readable: list.folderReadable },
    clockSkewSeconds,
    banners,
  };
}

// The vendored schema, compiled once. An event that fails it is still used, only counted.
export function makeSchemaCheck(schemaPath: string): (evt: Record<string, unknown>) => boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
  return (evt) => validate(evt) === true;
}
