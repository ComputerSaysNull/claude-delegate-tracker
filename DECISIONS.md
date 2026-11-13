<!-- BUDGET-PER-ENTRY: 45 -->
# Decisions

Structural decisions only: ones that shape how the tracker is built and would be costly to
reverse. Newest first; the headings are the index. A decision's body is never edited. When
it stops being true, only its heading changes, to say what replaced it.

## ADR-0007 — 2026-11-13 — The tracker shows the copies the server kept of images — Accepted

### Context

ADR-0006 shows an image from the path a stream recorded, so a file a script rewrote after the model read it shows its new version. Since transcript format 1.17 the server keeps a copy of every image it sent, in a folder beside the stream, named by the sha256 of the bytes, and lists those names in the stream.

### Decision

When a stream lists kept copies, the page shows them, not the file on disk. The backend reads a copy only by a name the stream listed that is 64 lowercase hex digits and a raster suffix, only from that stream's own `<stem>.images` folder (the stream found by its own listing, never from the URL), with that folder as the only root, through the same checks as ADR-0006. Copies are shown even when `IMAGE_ROOTS` is unset: they sit beside the stream the tracker already reads and hold nothing the stream did not send. A copy that cannot be read falls back to the file on disk, which says so.

### Consequences

Older streams, and images past the server's cap, still show the file as it is on disk now. The tracker reads the folder, not the feed, so the feed's image route goes unused.

## ADR-0006 — 2026-11-11 — The tracker reads images the streams name — Accepted

### Context

Delegations can run for hours on work with images, and the reader wants to see them while the run goes on. The streams record each image's absolute path (a prefetched file, or a `read_file` call that returned an image) but not the image itself. Until now the tracker opened only the stream files it listed.

### Decision

On request, the backend reads an image from the path the stream recorded, never a path from the URL. It reads only inside the folders `IMAGE_ROOTS` names, after links are resolved, only raster types, only a regular file under a size cap. The file the open holds is checked again, because a delegation can change its workspace between the check and the open. With no roots set, images are off.

### Consequences

The page shows the file as it is on disk now, which a script may have changed since. It works only where the tracker can see the delegations' files, so not through the feed. A path in a stream is trusted as far as the roots allow.

## ADR-0005 — 2026-10-07 — The tracker keeps its own records on disk — Accepted

### Context

History needs totals over weeks. The streams can be deleted from the folder, and the model server's figures over time exist only while the tracker samples them. Until now the tracker wrote nothing.

### Decision

The tracker keeps its records in a per-user data folder outside the repo, which `DATA_DIR` can move. It writes only files it names itself, each replaced whole. A record built from a stream is checked against that stream at every start while the stream exists, and the disagreements are counted and shown.

### Consequences

A restart keeps history, and so does deleting streams. The records can drift from the streams, so the check runs at every start and costs a full read of the folder. Deleting the folder resets history.

## ADR-0004 — 2026-10-03 — Who may open the page — Accepted

### Context

The page shows every delegation's task text, replies and reasoning, so who can open it matters.

### Decision

For now, anyone on the overlay VPN may open the page. The tracker listens on loopback only, and a Host check stops DNS rebinding. Tightening later means accepting only the user's own identity, from a header the VPN proxy adds. That header's name lives in the local environment, not in code or docs.

### Consequences

The page is never published to the internet. Every device on the overlay VPN can read every delegation. The tightening option needs no server change.

## ADR-0003 — 2026-10-03 — Node figures over SSH with a restricted key — Accepted

### Context

The tracker shows each cluster node's CPU and GPU use and temperature. The nodes should need nothing installed, and a key on the workstation must not open a shell.

### Decision

Figures come over SSH. The backend keeps one open connection per node and, on a fixed interval, runs one read-only stats command on it. A dedicated key is limited by `restrict,command=` to that one command. Each node's host key is pinned. Not chosen: a standard exporter on each node, a small agent of our own, and reading an existing dashboard's API.

### Consequences

Nothing is installed on the nodes. A stolen key can only read the figures, not run any other command. A fake node could feed invented figures, so each node's host key is pinned and a mismatch is refused.

## ADR-0002 — 2026-10-03 — What the tracker relies on from the server — Accepted

### Context

The tracker relies on the server for stream files and their contents. What it relies on must be stable, so a server change cannot silently break the tracker.

### Decision

Stream files are read directly from the transcript folder. Only contract fields are used: list states come from events, never from the feed's row layout. The schema is pinned to a server release and vendored into the repo. At runtime the schema is tolerant: every event is used, and failures are only counted for the health report. The feed is the way in only if the tracker moves to a machine that cannot see the folder.

### Consequences

A server minor adds fields and event kinds that the tracker skips. A server major shows a banner and renders best-effort. The first version does not use the feed.

## ADR-0001 — 2026-10-03 — Languages — Accepted

### Context

The tracker has several parts with different needs: the page, the backend, the copied repo machinery, and the node stats command. One language for everything is not a requirement.

### Decision

The page and the backend are TypeScript on Node. The repo machinery (the docs gate, hooks and publishing) is Python, standard library only, as it was copied from the server. The node stats command is a shell command on each node. Tests run outside the delegation sandbox, which has no Node.

### Consequences

One event shape is defined once and shared by the page and the backend. There is one toolchain to install, test and lint. The Python piece stays where it already works; the gate and its tests are the only Python in
the repo.
