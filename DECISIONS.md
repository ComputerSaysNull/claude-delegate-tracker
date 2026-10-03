<!-- BUDGET-PER-ENTRY: 45 -->
# Decisions

Structural decisions only: ones that shape how the tracker is built and would be costly to
reverse. Newest first; the headings are the index. A decision's body is never edited. When
it stops being true, only its heading changes, to say what replaced it.

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
