<!-- BUDGET-PER-ENTRY: 20 -->
# Journal

What took real work to find out, or would surprise you again in six months: usually a
measurement and what it settled. Newest first; the headings are the index. Routine work
leaves no entry.

## 2026-10-03 — Field meanings checked against the server source: no contradictions, three null cases

Each non-enumerated field claim in the starting field guide was checked against the server's
transcript writer at v0.6.0 and the vendored schema. None was contradicted. Three cases differ
from a first reading: `end`'s five counters are `null` for a one-shot; `end.finish_reason` and
`end.error` are left out, not `null`, when there is none; and `turn.tool_results_evicted` can be
`null` (one of the two samples has it), with the schema also allowing a boolean.

Some claims depend on code outside the writer (timing of `partial` and `waiting`, argument
caps, what a tool call's entry holds), so they rest on the server's docs, not on this check.
docs/ARCHITECTURE.md carries the rules that follow.

## 2026-10-02 — The server's feed is too slow to poll every 2 s

Measured on the transcript folder the workstation holds: 1,161 streams, 42 MB. `/list` took 48 s on the first call and 3.5 s on the next two. One `/events` read from offset 0 took 2.1 s.

This settled that the tracker reads the transcript folder directly rather than through the feed.

## 2026-10-02 — Reading the transcript folder directly from Windows is fast

Listing 1,162 stream names took 69 ms. Reading the newest 20 whole took 6 ms (1.2 MB). The names sort newest first.

This settled the folder reader: it lists names and reads the newest streams straight from the folder, with no feed.

## 2026-10-02 — The WSL and Windows clocks agree while awake

WSL minus Windows was −0.8 s, inside the 1 s resolution of the HTTP `Date` header used to measure it.

Whether they still agree after the machine sleeps is not yet measured.

## 2026-10-02 — A stream file name's stamp is UTC, to the millisecond

Read in the server's source at v0.6.0: the stamp is taken just before `start` is written.

It is not part of the contract yet, so a name without the stamp raises a health banner rather than vanishing silently.

## 2026-10-02 — The model server exposes all seven metric names the tracker reads

Names were checked on the live metrics endpoint; nothing else was printed. All seven are present.

## 2026-10-02 — The v0.6.0 release carries the schema as a release asset

Its two sample streams hold all eight event kinds. The schema never sets `additionalProperties: false`, so fields from later minor versions still pass.
