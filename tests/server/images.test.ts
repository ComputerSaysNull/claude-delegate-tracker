// An image the stream names is read only from inside the configured image roots, only as a
// raster type, only when it is a regular file under the size cap. Every refusal is a test.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readImage } from "../../src/server/images.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let base = "";
let root = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "images-")));
  root = join(base, "root");
  mkdirSync(join(root, "views"), { recursive: true });
  mkdirSync(join(base, "root-evil"));
  mkdirSync(join(base, "outside"));
  writeFileSync(join(root, "views", "front.png"), PNG);
  writeFileSync(join(root, "views", "photo.JPG"), PNG);
  writeFileSync(join(root, "views", "plot.svg"), "<svg/>");
  writeFileSync(join(root, "views", "notes.txt"), "text");
  writeFileSync(join(root, "views", "big.png"), Buffer.alloc(2048));
  mkdirSync(join(root, "views", "folder.png"));
  writeFileSync(join(base, "outside", "secret.png"), PNG);
  writeFileSync(join(base, "root-evil", "a.png"), PNG);
  symlinkSync(join(base, "outside", "secret.png"), join(root, "views", "link.png"));
  symlinkSync(join(root, "views", "plot.svg"), join(root, "views", "svg-in-disguise.png"));
  writeFileSync(join(root, "..dots.png"), PNG);
  execFileSync("mkfifo", [join(root, "views", "pipe.png")]);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const read = (path: string, roots = [root], max = 1024) => readImage(path, roots, max);

describe("reading an image the stream names", () => {
  it("serves a PNG inside a root with its type", async () => {
    const got = await read(join(root, "views", "front.png"));
    expect(got).toEqual({ kind: "ok", type: "image/png", bytes: new Uint8Array(PNG) });
  });

  it("knows a JPEG by its extension, whatever its case", async () => {
    const got = await read(join(root, "views", "photo.JPG"));
    expect(got.kind === "ok" && got.type).toBe("image/jpeg");
  });

  it("is off when no root is configured", async () => {
    expect(await read(join(root, "views", "front.png"), [])).toEqual({ kind: "off" });
  });

  it("refuses a file outside every root", async () => {
    expect((await read(join(base, "outside", "secret.png"))).kind).toBe("refused");
  });

  it("refuses a folder that only starts with a root's name", async () => {
    expect((await read(join(base, "root-evil", "a.png"))).kind).toBe("refused");
  });

  it("refuses a path that climbs out of the root", async () => {
    expect((await read(join(root, "views", "..", "..", "outside", "secret.png"))).kind).toBe("refused");
  });

  it("refuses a link inside the root that points outside it", async () => {
    expect((await read(join(root, "views", "link.png"))).kind).toBe("refused");
  });

  it("refuses an SVG, which can carry script", async () => {
    expect((await read(join(root, "views", "plot.svg"))).kind).toBe("refused");
  });

  it("refuses a link named .png that points at an SVG", async () => {
    expect((await read(join(root, "views", "svg-in-disguise.png"))).kind).toBe("refused");
  });

  it("refuses a file that is not an image type", async () => {
    expect((await read(join(root, "views", "notes.txt"))).kind).toBe("refused");
  });

  it("refuses a relative path", async () => {
    expect((await read("views/front.png")).kind).toBe("refused");
  });

  it("refuses a folder named like an image", async () => {
    expect((await read(join(root, "views", "folder.png"))).kind).toBe("refused");
  });

  // A delegation can make a named pipe in its workspace; opening one to read waits for a writer
  // forever, and four such waits stall every file read in the tracker.
  it("refuses a named pipe named like an image, without waiting on it", async () => {
    expect((await read(join(root, "views", "pipe.png"))).kind).toBe("refused");
  }, 2000);

  it("serves a file whose name starts with two dots", async () => {
    expect((await read(join(root, "..dots.png"))).kind).toBe("ok");
  });

  // The checks and the open are two steps; a delegation could swap a folder for a link between
  // them. The file actually opened is checked again, and a final link is never followed.
  it("refuses when a folder on the way became a link to outside after the checks", async () => {
    const dir = join(root, "swap");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.png"), PNG);
    writeFileSync(join(base, "outside", "a.png"), PNG);
    const got = await readImage(join(dir, "a.png"), [root], 1024, async () => {
      rmSync(dir, { recursive: true });
      symlinkSync(join(base, "outside"), dir);
    });
    expect(got.kind).toBe("refused");
    rmSync(dir);
  });

  it("refuses when the file itself became a link after the checks", async () => {
    const file = join(root, "views", "turns-link.png");
    writeFileSync(file, PNG);
    const got = await readImage(file, [root], 1024, async () => {
      rmSync(file);
      symlinkSync(join(base, "outside", "secret.png"), file);
    });
    expect(got.kind).toBe("refused");
    rmSync(file);
  });

  it("refuses a file over the size cap", async () => {
    expect((await read(join(root, "views", "big.png"))).kind).toBe("refused");
  });

  it("says a file that is gone is missing", async () => {
    expect(await read(join(root, "views", "gone.png"))).toEqual({ kind: "missing" });
  });
});
