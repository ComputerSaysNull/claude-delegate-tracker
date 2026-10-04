<!-- BUDGET: 400 -->

# Architecture

This document explains how the tracker works and why.

## The problem

A delegation is a black box until it lands. This tracker is a web page that shows, live, what each delegation is doing and how busy the cluster is. It is for one person, on a laptop or a phone, over the overlay VPN.

It only reads. It never starts, stops or changes a delegation.

## Where it runs

The tracker runs on the workstation, on the Windows side. It reads the transcript folder directly: the folder is on the Windows drive, and so is the tracker.

```
 workstation
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ WSL                                                                      │
 │   MCP server(s) ──writes──► transcript folder (.jsonl streams,           │
 │                             on the Windows drive)                        │
 │                                  ▲                                       │
 │ Windows                          │ read directly                         │
 │   tracker backend (Node) ────────┘                                       │
 │          ├──► model server /metrics   (over the overlay VPN)             │
 │          └──► each cluster node, over SSH                                │
 │          ▼                                                               │
 │   overlay VPN serve ──► tracker port on localhost                        │
 └──────────────────────────────────────────────────────────────────────────┘
        ▲
        └── phone or laptop browser, over the overlay VPN only
```

- The tracker listens on loopback only. Nothing is exposed except through the overlay VPN's serve, which only devices on that private network can reach.
- Every Claude Code session runs its own MCP server, and all of them write to the same transcript folder, so one folder covers every session.
- Where the streams and the figures come from are settings.

## Thick backend, thin page

The backend turns raw events and metrics into ready-to-show state: list rows, turns, counters, figures. The page only lays it out. Every rule in the rendering rules below lives in one place, and is tested there without a browser.

## Stack

TypeScript everywhere (ADR-0001). Node runs the backend, using Hono with its Node adapter. The page uses Vite, React, Tailwind CSS and shadcn/ui components. Charts use uPlot, Markdown react-markdown, icons lucide-react, and the fonts are IBM Plex Sans and Mono from Fontsource, bundled so the page asks no other host. Tests use Vitest, schema checks use Ajv (JSON Schema 2020-12), and packages come from npm.

The repo machinery (the docs gate, hooks, publishing) is Python, copied from the server, standard library only; it and its tests are the only Python in the repo.

## What the backend does

| Job | How often | Detail |
|---|---|---|
| Discover streams | 2 s after the previous pass | List the `*.jsonl` names in `TRANSCRIPT_DIR`. Each name starts with a UTC timestamp, so sorting names puts the newest first; take the newest 25 by name, then order and cut to 20 by `start.at`. Nothing else is opened to choose them. The margin covers the few milliseconds by which a name's stamp precedes `start.at`. A name without the stamp sorts after every stamped one and is counted in health. |
| Read each listed stream | The one being followed: 1 s after its previous read; other unfinished ones: 2 s after theirs; finished ones: never again | Keep one reader per stream: a byte offset plus the state built from its events so far. Each read takes the bytes from the offset to the end of the file, at most 1 MiB at a time, and keeps whole lines only. A reader whose name has left the newest 20, and that no page follows, is dropped. |
| Scrape the model server | every 10 s | See "The model server". |
| Read the nodes | every 5 s | Over SSH, see "The nodes". |
| Push changes to the page | as they happen | Server-Sent Events. |
| Report health | always | Transcript folder readable, each figures source reachable, unknown contract majors seen, events that failed the schema, names without the timestamp prefix, clock skew. |

- Intervals count from the previous pass, never from a fixed clock, so polls never overlap.
- Reading the folder is fast; see JOURNAL.md.
- Followed means at least one SSE connection subscribes to the stream (`/api/updates?stream=<name>`). Several pages may follow several streams.
- Clock skew. Event times come from WSL's clock, "now" from Windows'. A line that appeared since the previous read was written at most one read interval ago, so `now − at` on it measures the skew to within that interval. Over 5 s either way: a banner, since every age is then wrong. With nothing running there is nothing fresh to measure, and the banner keeps its last reading.

## Backend to page API

| Route | Returns |
|---|---|
| `GET /` | The page (built static files). |
| `GET /api/streams` | The list rows, already derived (state, why, age, kind, model, effort, title, start time, elapsed, turns, an unknown format), plus whether the list is capped, how many streams the folder holds, how many names lack the stamp, whether the folder was readable, and how many lines were not JSON. |
| `GET /api/streams?before=<name>` | The next 20 streams older than `<name>` by name, ordered like the list, and the cursor for the next page. `<name>` must be one the backend listed itself, else `404`. Each is read whole on request and never polled. |
| `GET /api/streams/<name>` | One stream's full derived view. `<name>` is looked up among the names the backend listed itself; anything else is `404`. A name from a URL is never joined onto a path. |
| `GET /api/cluster` | The latest model server and node figures, and when each was read. |
| `GET /api/cluster/history` | The same figures over time, for the charts. See "Figures over time". |
| `GET /api/health` | The health report: when it was checked, whether the transcript folder is set and readable, the clock skew, and the banners to show, already worded. Never the folder's path. |
| `GET /api/updates?stream=<name>` | An SSE stream. A `list` event with the whole list on connect and again whenever the list changes, and `cluster` and `health` events with the figures and the health report the same way. With `stream=`, also a `stream` event each time that stream's view changes: its row, its waiting line, its summary, and only the turns that changed, never the closed turns already sent. An unknown name is `404`. A `: ping` comment every 15 s. |

The page closes its SSE connections when it is hidden, and reloads if the browser brings it back from its back/forward cache: over HTTP/1.1 a browser allows six connections per host, and cached pages holding theirs stalled every new page.

Each `stream` event carries a number one above the last. The page fetches `/api/streams/<name>` whole when the SSE stream opens or reopens, and again whenever a number is skipped, rather than replaying.

All routes are GET-only, with no CORS headers: any other method gets `405`, and a request whose `Host` is not a loopback name or in `ALLOWED_HOSTS` gets `403` before any route runs. Any other path serves the built page (`dist/web`), so a deep link opens the page. The page keeps no state the backend doesn't have.

## When something fails

| Failure | What the tracker does |
|---|---|
| The transcript folder is unreadable | A banner, the last known state kept, retries after 1, 2, 4 … 30 s. |
| A stream file is shorter than its reader's offset | It was replaced (by the sync client, say): read it again from 0 and rebuild its state. |
| A figures source is unreachable | Its panel shows `—` and "no figures since <time>". |
| A stream names a contract major this tracker does not know | A banner on that stream, then a best-effort render. |
| An event does not match the schema | It is still used, and counted in health. |

## Settings

`TRACKER_PORT`, `TRANSCRIPT_DIR` (the transcript folder, as a Windows path), `METRICS_URL`, `METRICS_TOKEN_ENV` (optional: the name of an env var holding a bearer token), `NODES` (each node's display name, SSH host and user), `NODE_KEY` (the path of the dedicated SSH key; the key itself never enters the repo), `NODE_KNOWN_HOSTS` (the path of the file pinning each node's host key), `QUIET_AFTER_SECONDS`, `HISTORY_WINDOW_SECONDS`, `ALLOWED_HOSTS` (extra Host names to accept, such as the overlay VPN's name for this machine), the poll intervals above, and the optional identity check.

Defaults live only in the settings module, never in docs or tests.

## The contract

What the tracker relies on from the server is settled in ADR-0002: the stream files are read directly, only contract fields are used, the schema is pinned to a release, and the runtime is tolerant.

### What the contract is

| Part | Where the tracker gets it |
|---|---|
| `transcript.schema.json`: JSON Schema (2020-12) for one line of a stream | A release asset of each server release. |
| Sample streams covering every event kind | The release's source archive, under `tests/transcript_samples/`. |
| The versioning rules | Below, owned by the server's ADR-0111. |
| What each field means | The server's docs at the pinned tag; the rendering rules below state what matters for display. |
| The file name | A UTC stamp `YYYYMMDDTHHMMSS.mmm` before the first `-`, taken just before `start` is written. This is not in the contract yet. Until it ships, a name without the stamp raises a health banner rather than vanishing silently. |
| The feed API | A short note at the end of this section, for a later move to another machine. |

### Field details that are easy to get wrong

Checked against the server source at v0.6.0 and the vendored schema:

- `end`'s counters (`tool_calls`, `tool_errors`, `bash_calls`, `bash_failures`,
  `failed_calls`) are integers, or `null` for a one-shot.
- `end.finish_reason` and `end.error` are left out when there is none. The schema also allows
  `null`, so treat absent and `null` the same.
- `turn.tool_results_evicted` can be `null`, and the schema also allows a boolean. Show it only
  when it is a number.
- `turn.announced` is always a boolean in format 1.1; it is absent only in older streams.

### Pinning

The repo vendors the schema and the samples into `contract/`, with a `VERSION` file naming the server release. Only `scripts/update-contract.ts` (run as `npm run update-contract`) changes it, in a PR of its own. The script downloads the schema with `gh release download`, takes the samples from the same release's source archive, runs the contract tests, and prints what changed.

### Versioning rules

- The first event of every stream, `start`, carries `format: "<major>.<minor>"`. Today it is `"1.4"`. A stream without `format` was written before versioning existed: read it as 1.0.
- minor = something was added (a field, or an event kind). Keep working.
- major = something was removed, renamed, or changed meaning. Show a banner, and render on a best-effort basis.
- Ignore what you do not know, and never treat it as an error. An unknown field: use the rest of the event. An event of an unknown kind: leave it out of the display. Never drop a known event because it has an unknown field. That is what lets the tracker pin 1.x while the server adds things.

### The feed (for a later move to another machine)

The tracker reads the folder directly, so it does not use the feed. The feed is the way in when the tracker runs on a machine that cannot see the folder (a small always-on box). It is a read-only HTTP view of the streams, started with the server's terminal viewer in feed mode. It binds loopback only and is GET-only. Its `/list` returns the newest 20 streams, and `/events` returns whole lines from a byte offset. No row key is part of the contract; a move starts by pinning the row keys it needs. The feed is slow to list today, so it is polled from the previous answer, never on a fixed clock. There are no CORS headers, on purpose: the backend reads it, a browser page cannot.

## The model server

The figures come from the model server's Prometheus text at `<METRICS_URL>/metrics`. That is the server root, not under `/v1`. Send `Authorization: Bearer <token>` only when a token is configured.

Read only these names. Ignore every other metric: some carry deployment details in their labels, and label values are never shown.

| Metric | Kind | Shown as |
|---|---|---|
| `vllm:num_requests_running` | gauge | requests running |
| `vllm:num_requests_waiting` | gauge | requests waiting |
| `vllm:kv_cache_usage_perc` | gauge (0–1) | KV-cache use, × 100 % |
| `vllm:generation_tokens_total` | counter (tokens) | decode speed = difference between two scrapes ÷ seconds between them |
| `vllm:prefix_cache_hits_total`, `vllm:prefix_cache_queries_total` | counters (tokens) | prefix-cache hit rate since the engine started = hits ÷ queries |
| `vllm:num_preemptions_total` | counter | preemptions (shown when above 0) |

Rules for every figure (the node figures follow them too):

- A counter that went down means its source restarted (the engine, or the node for `/proc/stat`): drop that window and show no rate.
- The first reading has nothing to compare with: no rate yet.
- Show how long a window a rate was measured over. If nothing was read for hours, that window is hours long, and the rate says little about now.
- A figure that is missing (not reported, or no rate yet) shows `—`. A figure reported as 0 shows 0.

Rules for the model server only:

- Its counters count tokens, not requests.
- A `/metrics` that answers `404` means "not available", not "idle".
- These are one engine's figures, not a fleet's. A name that appears more than once (a second engine) is left out rather than summed.

## The nodes

The node figures come over SSH, with nothing installed on the nodes (ADR-0003). The backend keeps one SSH connection per node open and, every 5 s, runs one fixed read-only command on it. The command prints:

| Figure | Read from | How |
|---|---|---|
| CPU use (%) | `/proc/stat` | 100 × (1 − Δidle ÷ Δall) between two readings, over all CPUs |
| CPU temperature | `/sys/class/thermal/thermal_zone*/temp` (or `/sys/class/hwmon`) | the hottest CPU sensor |
| GPU use (%) and GPU temperature | `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits` | as reported |

- The key can run nothing else. A dedicated key, used only by the tracker, is listed in each node's `authorized_keys` as `restrict,command="<the stats command>"`. `restrict` turns off forwarding, the pty and `~/.ssh/rc`, including restrictions added in later OpenSSH versions. Whoever holds the key can read those numbers, and cannot open a shell.
- Each node's host key is pinned. The Node `ssh2` library accepts any host key unless it is given a `hostVerifier`, so the backend checks each node against the file `NODE_KNOWN_HOSTS` names, and refuses a mismatch with a health banner. A fake node could not steal the key that way, but it could feed the panel invented figures.
- Use a Node SSH library that keeps the connection open, rather than starting `ssh` for each poll. One login per poll would add load and fill the nodes' auth logs.
- Which thermal zones and `nvidia-smi` fields are read is settled by measuring the nodes, not assumed. Measured: every zone is of type `acpitz` and none is named for the CPU, so the hottest zone is shown as "CPU"; `nvidia-smi` gives numbers, and `[N/A]` would show `—`. Memory figures are not shown. Sensors are shown with plain names ("CPU", "GPU"); raw zone and chip names are never shown.
- The command prints three sections, `==stat`, `==thermal` and `==gpu`, so one missing section blanks only its own figures.
- A node refused for its host key says so on its panel; one that can't be reached keeps the time of its last good reading. Each node fails alone.

## Figures over time

- The backend keeps a point per reading for `HISTORY_WINDOW_SECONDS`, in memory only, so a restart starts the charts afresh.
- A missing figure is a gap, never 0, and a source that is down adds a point of gaps, so a chart shows the outage instead of joining across it.
- The page fetches the history once, then adds each `cluster` event's figures itself.
- A chart is a bare line with no axes. It follows its container's width, and keeps its size while hidden.

## Titles

A delegation shows the title its caller gave in `start.title` (format 1.2), trimmed. Without one, or with a blank one, the title is derived from its task: take the first non-blank line of the task, trimmed. If it is longer than 60 characters, cut it at the last space before character 60 and add `…`; with no space, cut at 59 and add `…`. An empty task shows `(no task)`.

## Rendering rules

These are the rules the code is tested against, one test per rule. They were learned the hard way by the server's terminal viewer.

### States

Every stream has exactly one state, picked by the first rule below that applies.

1. **stopped**: `end.ended` is `stopped`: the caller stopped it. Neutral, with a stop-square icon.
2. **timed out**: `end.ended` is `queue_timeout`, `deadline` or `stalled`: a limit was hit, so it is orange like cut off. Say which: waited too long in the queue, ran past its deadline, or stalled because the backend went quiet.
3. **failed**: an `end` event exists and `end.ok` is false. Only an error is failed; a stream without `ended`, or with a value the tracker does not know, stays failed, and the words in `error` are never read to decide.
4. **cut off**: an `end` event exists, `end.ok` is true, and `finish_reason` is `length` or `content_filter`. Show why: raise `max_tokens` or split the task, or "the endpoint stopped it", which is not a budget problem.
5. **ok**: any other stream with an `end` event. A finished stream is never "quiet", however old.
6. **asking**: a `question` with no `answer` after it. Its age is the time since the question. A run waiting on its caller is never "quiet", however long the answer takes; it shows blue like running, with a question-mark icon, and counts as running.
7. **quiet**: no event for `QUIET_AFTER_SECONDS`; show its age. Measure from the last event's `at`, not the file's time: the folder is synced and file times move.
8. **queued**: the last signal (`waiting`, `priced`, `turn`, `alive`, `end`) is `waiting`. Its age comes from `waited_seconds`, not from silence.
9. **live**: everything else.

Rule 7 comes before rule 8 on purpose. A queued delegation writes `waiting` about every 30 s and a running one writes `alive` at least every 60 s, so the quiet threshold must stay well above the server's keepalive interval, which the tracker cannot see. Show an age as `59s`, `1m` … `89m`, `1h`.

### The list

- Order by `start.at`, newest first, never by last activity.
- Say when the list is capped at 20, and offer older ones a page at a time; older pages are a snapshot, not live.
- Search and filters (title words, state, kind, model) apply to the rows loaded so far, live and older alike, and say how many of them they show.
- Kind: `?` when `tools` is absent; `one-shot` when `tools` is `[]`; otherwise the tool name.
- Group the rows by start date in the viewer's own days: "Today · 4 Oct", "Yesterday · 3 Oct", the other days of this week (from Monday) by weekday, "Last week", then months, with the year when it is not this year. Each group folds, starts open and shows its count; older pages join the same groups.
- Above the list, count what is running and queued now, and what failed today; runs that timed out or were stopped today are counted apart, and only when there are any.
- A card leads with the state's icon (named for a screen reader), the title and the start time; under them its kind, its turns ("turn N of M" while running, "N turns" after) and how long it took. A running card shows its turns as segments (done, the current one, those to come) and the newest heartbeat's `ends_in_seconds` as the time left; a queued card shows its wait and its limit.
- The states filter is one menu of checkboxes, beside the search box.

### Layout

- A header bar names the tracker and says whether updates are live (with the newest check's time, or "Reconnecting…") and whether the backend is healthy, as two pills. The cluster figures run across the top. Below them, on a wide screen, the list sits on the left in a capped column and the open delegation on the right, each scrolling on its own while the header and cluster stay in place; with none open, the right side asks for a choice.
- Opening a delegation never loads a page; a click with a modifier key is left to the browser, so a new tab still works.
- The address holds the open delegation (`/s/<name>`) and the filters (`q`, `state`, `kind`, `model`), so Back, reload and a bookmark land on the same view. Opening or closing a delegation is a step Back undoes; a filter change only rewrites the current address. A state the page does not know is left out, and a name that cannot be decoded opens nothing.

### On a phone

- One pane at a time: the list, or the open delegation with a way back to the list.
- Long unbroken text (paths, commands, replies) wraps; nothing widens the page past the screen.
- A value cut to one line opens in full on a tap, since a phone has no hover for a tooltip.

### Absent is not zero

- A missing figure shows `—` or nothing, never `0` or `0%`; a measured 0 shows as 0. This applies to cached tokens, reuse, tokens returned, load, effort, attempts, sizes, exit codes and tool time.
- Show `attempts` only when above 1, and the repeated share only at 15% or more.
- Omit the whole-run summary when none of its fields are present.
- Show the shell count only when above 0. Show the "thinking / answering" split only when `reasoning_chunks` is present.

### Tokens

- cached: for a finished stream, `end.cached_tokens`; for a running one, the sum over turns.
- reuse = cached ÷ prompt tokens sent, a share, never a running total.
- returned = what reached the caller. Blank until finished, then `end.output_tokens`, or else the last turn's.
- load = prompt + output summed over all turns: what the cluster processed.
- `tool_calls` is an integer (or `null`) on `end` and a list on `turn`: check the type before using it.

### A delegation as a conversation

- The task is the caller's message, on the right, with the files it was given or refused. Each turn is the delegation's message, on the left: its tool calls as one compact row each, its text, and a line of its figures (tokens in and out, `turn.out_tok_s`, tool time), leaving out any it does not have. A finished run ends with a note saying it finished, failed, timed out or was stopped.
- Each turn is headed by the model, its number and when it started (its `priced` event's `at`); a call shows its first argument on its own line beside its name; token counts are written short ("4.6k", "1.3M"). A refused file is a chip marked "refused", with the reason in full under the chips. The end note says in one line how the run ended, how long it took, its turns and its cache use, with the other figures in one line below. "Jump to latest" is offered only while the run is going.
- A header stays on screen: the state, the title, the turns as a bar, and, while the run is going, the time used as a bar from the newest heartbeat's `elapsed_seconds` of `of_seconds` with the time left, and the heartbeat. A run stopped mid-turn never closes that turn, so its old clock and heartbeat are not shown.
- A question to the caller shows in its turn as a highlighted message from the delegation, with "Waiting for an answer" and for how long (a pulsing dot) while the run waits, and "Answered after" how long once it has an answer; the caller's answer follows as the caller's message, saying when the caller left the choice to the delegation (`best_reading`). `question` and `answer` carry no turn number: they belong to the newest turn that has been priced.
- The task and every reply, as written and when done, render as Markdown. Raw HTML in them shows as text and never runs; a link opens in a new tab with `noopener noreferrer`, and a `javascript:` link is not made clickable.
- The view follows the growing reply while the reader is at the bottom; scrolled up, it stays put and offers "Jump to latest". No copy buttons.

### Turns and calls

- `priced` opens a turn (heading "turn N of M"); `turn` closes it; heartbeats and calls in between belong to that turn.
- The budget line names its turn number.
- Say "of M" only when `of_turns` is present.
- In an announced turn, show the calls once, with their results. In an unannounced (older) turn, show the calls with their arguments.
- A call is a success when its outcome is `ran` or `repeat`; anything else is a failure.
- Show a refusal's `message` in full and prominently, and shorten the arguments first.
- Show every argument; don't drop the ones you have no layout for.
- Never read a field the contract doesn't have.
- A turn's tool time = the sum of its calls' `ms`. Fall back to `ms − backend_ms` only when the calls carry no `ms` and there are calls. Say nothing for a turn without calls; show `<1s` for instant ones.
- Show durations as lengths (`2m51s`), not times of day.

### The reply as it is written

- `partial` events add to the open turn's reasoning and answer. Show the answer as it grows; fold the reasoning away until opened.
- When the turn's `turn` event lands, its `text` replaces the partial text, even where they differ: a retried attempt can leave text in `partial` that never reached the reply.
- A patch carries only the text added since the previous one.

### Failures

- Count failures from `end.failed_calls`. Only if that is absent or `null`, use `tool_errors + bash_failures`; if those are `null` too (a one-shot), show no count.
- A failure count above zero stands out; 0 stays quiet.

### Heartbeat and waiting

- Say "chunks", not "tokens".
- Show seconds since the last chunk only at 2 s or more.
- Zero chunks still reads "still running", not "nothing happening".
- Name the running tools with their status.
- The countdown is `ends_in_seconds`, the deadline that will actually end the run. Don't compute your own.
- A wait with `of_seconds` 0 shows no limit: "queued 3m", never "3m of 0s".
- Repeated `waiting` events update one line rather than adding lines, and the line keeps the newest total.

### Budget wording

- `requests_running`: with `rate_source` `cluster_since_boot`: "N running", a real cluster reading; with `observed_at_concurrency` or `own_turns`: "priced for N"; otherwise: "concurrency N".
- `budget_ceiling` null: show "no cap", not nothing.

### Reading streams

- Skip a line that is JSON but not an object.
- Never act on a half-written line: keep the bytes up to the last newline, and read the rest next time. Offsets are in bytes, so a character split across two reads is never decoded half. A single line longer than one read is read on to its end.
- When a stream finishes, leave it on screen: the last thing it wrote is usually what you were waiting for.
- Elapsed time: a finished stream uses `end.elapsed_seconds`; a running one counts up from `start.at`. Never use file times.
- Show times in local time (`at` is UTC), all through one formatter: a 24-hour clock ("19:00"), dates as "12 Nov", with the year ("12 Nov 2025") only when it is not this year.
- Follow the system's light or dark setting. Every colour is a named token in `index.css`, with a light and a dark value; text is at least 4.5:1 on its ground in both.
- Every state has its own icon besides its colour, the same in badges, cards and the conversation. A badge is a pill naming the state in a word: Running, Queued, Quiet, Done, Failed, Cut off. A run in progress (running, queued) gets a tinted card; a finished one stays plain.
- Words in IBM Plex Sans. A figure, time, duration or piece of code that stands on its own is in IBM Plex Mono, with tabular digits so a ticking number keeps its width; one inside a sentence stays in the sentence's font.

## Security

- Exposure: the tracker listens on loopback. Only the overlay VPN's serve reaches it, so only devices on that private network can. It is never published to the internet.
- Host check: the tracker accepts only loopback Host names plus `ALLOWED_HOSTS`. That stops a page on another origin from reading it through DNS rebinding.
- Read-only: GET routes and SSE only. No write or control endpoints without a new design.
- File access: the backend opens only `*.jsonl` files it listed itself in `TRANSCRIPT_DIR`, read-only. A name from a URL is looked up in that list and never joined onto a path, so no request can name a file to open.
- What it shows: every delegation's task text, replies and reasoning. So whoever can open the page can read all of it, and today that is every device on the overlay VPN, the cluster nodes included. Tightening that is ADR-0004.
- The node key is a dedicated SSH key that can run only the stats command. It lives outside the repo, and its path is in the gitignored `.env`.
- Secrets: a metrics token, if any, stays in its own environment variable. The gitignored `.env` holds only that variable's name (`METRICS_TOKEN_ENV`). The token is never sent to the browser and never logged.
- Public repo: the leak guards run from the first commit.

## Repo layout

```
package.json  tsconfig.json  vite.config.ts  eslint.config.js  .nvmrc
src/server/
    settings.ts         every setting and its default (the only place a default lives)
    folder.ts           transcript folder reader: names, offsets, whole lines
    streams.ts          stream state from events: the list row's rules
    view.ts             one stream's view: turns, calls, heartbeat, summary
    metrics.ts          Prometheus text parser, the name allowlists, derived rates
    nodes.ts            node figures over SSH: one open connection per node
    titles.ts           titles from the task
    poller.ts           one reader per listed stream; the list, re-derived each pass
    app.ts              Hono routes, SSE, Host check, static files
    main.ts             the entry `npm start` runs: settings, the app, loopback only
src/web/                React page: list, stream view, panels, banners
contract/               vendored from a server release, plus VERSION
scripts/update-contract.ts  the only thing that writes contract/
scripts/docs_gate.py  scripts/docs_ownership.toml  scripts/install_hooks.py
scripts/plan_stack.py  scripts/gen_gitleaks_config.py
security/               allowlists (committed) and forbidden_strings.txt (gitignored)
.claude/agents/
.env.example            placeholders only; the real .env is gitignored
tests/                  Vitest tests; tests/gate/ holds the gate's pytest tests
docs/ARCHITECTURE.md
README.md  CONTRIBUTING.md  CHANGELOG.md  DECISIONS.md  JOURNAL.md  CLAUDE.md
.github/workflows/ci.yml  .github/ruleset.json
```

There is no `LICENSE` file for now: no licence, all rights reserved.
