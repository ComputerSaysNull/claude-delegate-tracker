// Reads an image file whose path a stream recorded, for the page to show on request. The path
// comes from the stream, never from the URL, and is read only when, after links are resolved,
// it is a regular file inside one of the configured image roots, has a raster image extension,
// and is no larger than the cap. SVG is never served, because it can carry script.
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

export type ImageResult =
  | { kind: "ok"; type: string; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "off" }                       // no image roots configured
  | { kind: "missing" }                   // the file is gone, or the stream names no such image
  | { kind: "refused"; reason: string };  // outside the roots, not an image type, not a file, or too large

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function typeOf(file: string): string | null {
  return TYPES[path.extname(file).toLowerCase()] ?? null;
}

function inside(file: string, root: string): boolean {
  const rel = path.relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

async function realRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    try {
      out.push(await realpath(root));
    } catch {
      // A root that does not exist holds nothing to serve.
    }
  }
  return out;
}

// Why a resolved path may not be served, or null when it may.
function refusal(real: string, roots: string[]): string | null {
  if (typeOf(real) === null) return "not an image type";
  if (!roots.some((root) => inside(real, root))) return "outside the image roots";
  return null;
}

// Opened without following a final link and without waiting: a named pipe would otherwise
// hold the open until something writes to it, and a few such waits stall all file reads.
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

// `beforeOpen` runs between the checks and the open; only tests use it, to swap a folder for
// a link in that gap and show that the file actually opened is checked again.
export async function readImage(
  file: string,
  roots: string[],
  maxBytes: number,
  beforeOpen?: () => Promise<void>,
): Promise<ImageResult> {
  if (roots.length === 0) return { kind: "off" };
  if (!path.isAbsolute(file)) return { kind: "refused", reason: "not an absolute path" };
  let real: string;
  try {
    real = await realpath(file);
  } catch {
    return { kind: "missing" };
  }
  // The type is judged on the file the path finally names too, so a link cannot rename an SVG.
  if (typeOf(file) === null) return { kind: "refused", reason: "not an image type" };
  const rootsNow = await realRoots(roots);
  const before = refusal(real, rootsNow);
  if (before !== null) return { kind: "refused", reason: before };
  const type = typeOf(real) as string;
  await beforeOpen?.();
  let handle;
  try {
    handle = await open(real, OPEN_FLAGS);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ELOOP" ? { kind: "refused", reason: "changed while it was read" } : { kind: "missing" };
  }
  try {
    // A folder on the way may have been swapped for a link since the check, so the file the
    // handle actually holds is checked again (where the system can say which file that is).
    const held = await realpath(`/proc/self/fd/${handle.fd}`).catch(() => null);
    if (held !== null && held !== real) {
      return { kind: "refused", reason: refusal(held, rootsNow) ?? "changed while it was read" };
    }
    const stat = await handle.stat();
    if (!stat.isFile()) return { kind: "refused", reason: "not a file" };
    // One byte more than expected is read, never more than the cap allows, so a large file
    // never fills memory; a filled buffer means over the cap, or grown since it was looked at.
    const buffer = new Uint8Array(Math.min(stat.size, maxBytes) + 1);
    let filled = 0;
    while (filled < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.byteLength - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled === buffer.byteLength) {
      return { kind: "refused", reason: stat.size > maxBytes ? "larger than the image size cap" : "changed while it was read" };
    }
    return { kind: "ok", type, bytes: buffer.subarray(0, filled) };
  } catch {
    return { kind: "missing" };
  } finally {
    await handle.close();
  }
}
