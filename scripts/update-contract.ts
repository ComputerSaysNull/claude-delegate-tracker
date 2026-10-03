#!/usr/bin/env node
/**
 * update-contract.ts — rebuilds the repo's contract/ folder from a server
 * release tag (transcript schema + sample transcripts). This is the ONLY
 * thing that writes contract/.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = "ComputerSaysNull/claude-delegate-local-mcp";
const root = path.resolve(import.meta.dirname, "..");
const contractDir = path.join(root, "contract");

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/update-contract.ts <tag>");
  process.exit(1);
}

function run(cmd: string, args: string[], cwd?: string) {
  const bin = cmd;
  const res = spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], cwd, shell: false });
  if (res.error) throw new Error(`Failed to run: ${bin} ${args.join(" ")}\n${res.error.message}`);
  if (res.status !== 0) {
    const msg = `Command failed: ${bin} ${args.join(" ")}` +
      (res.stderr && res.stderr.length ? `\n${res.stderr.toString()}` : "");
    throw new Error(msg);
  }
  return res;
}

function listFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      for (const [rel, full] of listFiles(p)) out.set(path.join(name, rel), full);
    } else {
      out.set(path.relative(dir, p), p);
    }
  }
  return out;
}

const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "contract-dl-"));
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "contract-new-"));
let exitCode: number;

try {
  run("gh", ["release", "download", tag, "-R", REPO, "-p", "transcript.schema.json", "-D", tmp1]);
  run("gh", ["release", "download", tag, "-R", REPO, "--archive=tar.gz", "-D", tmp1]);

  const archive = fs.readdirSync(tmp1).find((f) => f.endsWith(".tar.gz"));
  if (!archive) throw new Error("Source archive not found in temp dir.");
  run("tar", ["-xzf", archive], tmp1);

  const topDirs = fs.readdirSync(tmp1).filter((f) => fs.statSync(path.join(tmp1, f)).isDirectory());
  if (topDirs.length !== 1) throw new Error(`Expected one extracted source directory, found: ${topDirs.join(", ")}`);
  const samplesDir = path.join(tmp1, topDirs[0], "tests", "transcript_samples");
  if (!fs.existsSync(samplesDir) || !fs.statSync(samplesDir).isDirectory()) {
    throw new Error(`Missing samples dir: ${samplesDir}`);
  }
  const samples = fs.readdirSync(samplesDir).filter((f) => fs.statSync(path.join(samplesDir, f)).isFile());
  if (samples.length === 0) throw new Error(`Samples dir is empty: ${samplesDir}`);

  fs.copyFileSync(path.join(tmp1, "transcript.schema.json"), path.join(tmp2, "transcript.schema.json"));
  fs.mkdirSync(path.join(tmp2, "samples"));
  for (const s of samples) fs.copyFileSync(path.join(samplesDir, s), path.join(tmp2, "samples", s));
  fs.writeFileSync(path.join(tmp2, "VERSION"), tag + "\n");

  const oldVersion = fs.existsSync(path.join(contractDir, "VERSION"))
    ? fs.readFileSync(path.join(contractDir, "VERSION"), "utf8").trim()
    : "(none)";
  const newVersion = fs.readFileSync(path.join(tmp2, "VERSION"), "utf8").trim();
  console.log(`old VERSION: ${oldVersion}`);
  console.log(`new VERSION: ${newVersion}`);

  const oldFiles = listFiles(contractDir);
  const newFiles = listFiles(tmp2);
  for (const rel of newFiles.keys()) if (!oldFiles.has(rel)) console.log(`added: ${rel}`);
  for (const rel of oldFiles.keys()) if (!newFiles.has(rel)) console.log(`removed: ${rel}`);
  for (const rel of newFiles.keys()) {
    if (oldFiles.has(rel) && !fs.readFileSync(oldFiles.get(rel)!).equals(fs.readFileSync(newFiles.get(rel)!))) {
      console.log(`changed: ${rel}`);
    }
  }

  fs.rmSync(contractDir, { recursive: true, force: true });
  fs.cpSync(tmp2, contractDir, { recursive: true });

  // Vitest's own entry, run by this Node: Windows refuses to spawn npx.cmd without a shell.
  console.log("Running contract tests: vitest run tests/contract");
  const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
  const tests = spawnSync(process.execPath, [vitest, "run", "tests/contract"], { stdio: "inherit", cwd: root });
  if (tests.error) throw new Error(`Failed to run the contract tests: ${tests.error.message}`);
  exitCode = tests.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  exitCode = 1;
} finally {
  fs.rmSync(tmp1, { recursive: true, force: true });
  fs.rmSync(tmp2, { recursive: true, force: true });
}
process.exit(exitCode);
