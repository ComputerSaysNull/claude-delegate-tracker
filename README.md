<!-- BUDGET: 90 -->

# claude-delegate-tracker

A web page that shows, live, what each delegation is doing and how busy the cluster is. Built for one person, on a laptop or a phone, over the overlay VPN.

It reads the transcript files that `claude-delegate-local-mcp` writes. Without it, a delegation is a black box until it lands. This is the friendly view that also works on a phone and shows the cluster.

It only reads. It never starts, stops or changes a delegation.

## What it shows

The newest delegations, newest first, each with its state (live, queued, quiet, ok, failed, cut off), its kind, model, effort, title, elapsed time and turns used of budget. It updates without a reload.

One page for one delegation: the task, the files it was given, each turn with its tool calls and results, its reply, the end summary and any error. While it runs, the heartbeat shows as counters that change in place, not repeated lines.

The reply as it is written: partial events show the answer growing, with the reasoning folded away by default.

The model server panel: requests running and waiting, KV-cache use, decode speed, prefix-cache hit rate and any preemptions.

The node panel: for each cluster node, CPU and GPU use, and CPU and GPU temperature.

Works on a phone.

Health banners: it says plainly when the transcript folder, the model server figures or the node figures are unreachable, when a stream uses a contract version this tracker does not know, and how many events failed the schema.

Local time everywhere, dark and light themes.

## Running it

On Windows:

```sh
npm install
npm start
```

`npm start` builds the page, then starts the server and prints the address to open. That is the whole setup: it reads the transcript folder itself, so there is nothing else to start. It listens on loopback only.

Settings are read from the environment, and from a `.env` file in the repo root if there is one; a value already in the environment wins. A setting it cannot use (such as a `TRACKER_PORT` that is not a port number) stops the start with a message naming it.

To reach it from a phone, share the tracker port through the overlay VPN's serve, then open the page on the phone. Only devices on that private network can reach it.

## Configuring it

Settings come from the environment (see `.env.example` for the placeholders):

- `TRACKER_PORT` — the port the tracker listens on.
- `TRANSCRIPT_DIR` — the transcript folder, as a Windows path.
- `METRICS_URL` — the model server's metrics base URL.
- `METRICS_TOKEN_ENV` — optional: the name of an env var holding a bearer token.
- `NODES` — each node's display name, SSH host and user.
- `NODE_KEY` — the path of the dedicated SSH key.
- `NODE_KNOWN_HOSTS` — the file pinning each node's host key.
- `QUIET_AFTER_SECONDS` — how long a stream can be silent before it reads as quiet.
- `ALLOWED_HOSTS` — extra Host names to accept, such as the overlay VPN's name for this machine.
- The poll intervals, and the optional identity check.

Node figures are read over SSH with a dedicated key that can only run the stats command (ADR-0003).

## No licence

All rights reserved. You may read the code, but not reuse it.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it works and why.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how work is done.
- [DECISIONS.md](DECISIONS.md) — the decisions that shape it.
