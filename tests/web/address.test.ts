// The address carries the open delegation and the filters, so Back, reload and a bookmark
// land on the same view.
import { describe, expect, it } from "vitest";
import { addressFor, readAddress } from "../../src/web/address.ts";
import { NO_FILTER } from "../../src/web/filter.ts";

describe("reading the address", () => {
  it("opens the delegation in /s/<name>, decoded", () => {
    expect(readAddress("/s/stream%20one", "").selected).toBe("stream one");
  });

  it("opens none anywhere else", () => {
    expect(readAddress("/", "")).toEqual({ selected: null, filter: NO_FILTER });
    expect(readAddress("/other", "").selected).toBeNull();
    expect(readAddress("/s/", "").selected).toBeNull();
  });

  it("reads the search words, states, kind and model", () => {
    expect(readAddress("/", "?q=auth+module&state=failed,live&kind=claude-code&model=flash").filter).toEqual({
      text: "auth module",
      states: ["failed", "live"],
      kind: "claude-code",
      model: "flash",
    });
  });

  it("ignores a state it does not know, and repeats", () => {
    expect(readAddress("/", "?state=failed,bogus,failed,cut%20off").filter.states).toEqual(["failed", "cut off"]);
  });

  it("does not open a delegation whose name cannot be decoded", () => {
    expect(readAddress("/s/%E0%A4%A", "").selected).toBeNull();
  });
});

describe("writing the address", () => {
  it("is / with nothing open and no filter", () => {
    expect(addressFor({ selected: null, filter: NO_FILTER })).toBe("/");
  });

  it("puts the open delegation in the path, encoded", () => {
    expect(addressFor({ selected: "a b/c", filter: NO_FILTER })).toBe("/s/a%20b%2Fc");
  });

  it("puts only the filters that are set in the query", () => {
    expect(addressFor({ selected: null, filter: { ...NO_FILTER, states: ["failed", "cut off"] } })).toBe("/?state=failed%2Ccut+off");
  });

  it("reads back what it wrote", () => {
    const address = { selected: "s 1", filter: { text: "auth", states: ["queued" as const], kind: "one-shot", model: "flash" } };
    const url = new URL(addressFor(address), "http://x");
    expect(readAddress(url.pathname, url.search)).toEqual(address);
  });
});
