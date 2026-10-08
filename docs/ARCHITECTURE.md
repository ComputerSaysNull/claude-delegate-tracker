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
| `GET /api/streams/<name>/thinking/<turn>` | One finished turn's thinking, as text, fetched only when the page opens its fold. `<name>` is looked up among the names the backend listed itself and `<turn>` among the turns it holds; anything else is `404`. |
| `GET /api/cluster` | The latest model server and node figures, and when each was read. |
| `GET /api/cluster/history` | The same figures over time, for the charts. See "Figures over time". |
| `GET /api/runs` | Every run record, newest first, and how the records stand: how many, when they were last checked against the folder, how many disagreed, how many streams are gone, and the last write error. See "Run records". |
| `GET /api/busy` | The model server's KV-cache use per UTC hour over the last 90 days, and the last write error. See "Figures over time". |
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

`TRACKER_PORT`, `TRANSCRIPT_DIR` (the transcript folder, as a Windows path), `METRICS_URL`, `METRICS_TOKEN_ENV` (optional: the name of an env var holding a bearer token), `NODES` (each node's display name, SSH host and user), `NODE_KEY` (the path of the dedicated SSH key; the key itself never enters the repo), `NODE_KNOWN_HOSTS` (the path of the file pinning each node's host key), `QUIET_AFTER_SECONDS`, `HISTORY_WINDOW_SECONDS`, `DATA_DIR` (where the run records are kept), `RUNS_SCAN_SECONDS`, the load and heat thresholds (`LOAD_WARN_PERCENT`, `LOAD_HOT_PERCENT`, `TEMP_WARN_C`, `TEMP_HOT_C`), `ALLOWED_HOSTS` (extra Host names to accept, such as the overlay VPN's name for this machine), the poll intervals above, and the optional identity check.

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
- For History it also keeps the KV-cache use per UTC hour for 90 days in `busy.json` in `DATA_DIR`, since the streams cannot give it. The time between two readings counts by the earlier one, never more than three poll intervals; a reading the server did not answer, or without the figure, ends the count until the next. The file is replaced whole at most once a minute and whenever an hour starts.
- A missing figure is a gap, never 0, and a source that is down adds a point of gaps, so a chart shows the outage instead of joining across it.
- The page fetches the history once, then adds each `cluster` event's figures itself.
- A chart is a bare line with no axes. It follows its container's width, and keeps its size while hidden.
- The charts show the last hour, or the last 15 minutes when switched; the range never reaches past what the backend keeps.

### The cluster at a glance

- The model server's four figures (decode speed, requests running and waiting, KV-cache use, prefix-cache hits) sit side by side, each large under its label, with a small chart under each that has a history; the range switch sits in that card's header. The nodes sit side by side, without charts. Each chart leaves room above and below its values, so a flat stretch at 0 shows; KV-cache use is on a fixed 0–100 scale. The charts sit at the bottom of their columns, so they line up.
- Each node's CPU and GPU use is a donut with the number in the middle, its ring green under the load warning threshold, amber from it and red from the hot one, in a light shade of that colour. A CPU or GPU temperature sits inside a full ring of a donut's size, the ring green, amber or red by the heat thresholds, so the four figures read as equals. Use and temperature are whole numbers ("15%", "77°C"). No line names the window CPU use was measured over. A node shows GPU use, GPU temperature, CPU use, CPU temperature, in that order: the GPU does the model's work. The thresholds are settings, sent with the figures; a missing figure is an empty ring or `—`, never 0. The nodes card has one "as of" line, the newest healthy read; a node shows its own line only when it is unreachable or its host key is refused.
- On a phone the cluster figures run in one strip above the list (decode speed, requests running, KV-cache use, the hottest temperature) that links to the Cluster section; the strip is left out when there are no figures.

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
- Search and filters (title words, state, kind, model, repo) apply to the rows loaded so far, live and older alike, and say how many of them they show.
- Kind: `?` when `tools` is absent; `one-shot` when `tools` is `[]`; otherwise the tool name.
- Group the rows by start date in the viewer's own days: "Today · 4 Oct", "Yesterday · 3 Oct", the other days of this week (from Monday) by weekday, "Last week", then months, with the year when it is not this year. Each group folds, starts open and shows its count; older pages join the same groups.
- Above the list, count what is running and queued now, and what failed today; runs that timed out or were stopped today are counted apart, and only when there are any.
- A card leads with the state's icon (named for a screen reader), the title and the start time; under them its kind, its turns ("turn N of M" while running, "N turns" after) and how long it took. A card whose stream names a workspace leads that second line with the repo (`start.workspace`, format 1.5) in place of the tool kind. A running card shows its turns as segments (done, the current one, those to come); the time left is the details bar's. A queued card shows its wait and its limit. A click anywhere on a card opens the delegation; the title stays the link, for the keyboard and a new tab.
- The search box stays in view; a Filters button beside it counts the state, kind, model and repo filters that are on, and opens one panel holding those four controls. Each active filter shows as a chip under the search box that removes it.

### Layout

- A header bar names the tracker and says whether updates are live (with the newest check's time, or "Reconnecting…") and whether the backend is healthy, as two pills. The cluster figures run across the top. Below them, on a wide screen, the list sits on the left in a capped column and the open delegation on the right, each scrolling on its own while the header and cluster stay in place; with none open, the right side asks for a choice.
- Opening a delegation never loads a page; a click with a modifier key is left to the browser, so a new tab still works.
- The address holds the open delegation (`/s/<name>`) and the filters (`q`, `state`, `kind`, `model`, `repo`), so Back, reload and a bookmark land on the same view. Opening or closing a delegation is a step Back undoes; a filter change only rewrites the current address. A state the page does not know is left out, and a name that cannot be decoded opens nothing.

### Notifications

- Once the viewer allows them, a desktop notification says how a delegation ended ("Finished", "Failed", "Stopped", "Timed out", "Cut off", with the reason), once, and clicking it opens that delegation. Only a run seen still going on the page can notify. The browser offers notifications only in a secure context, so the page offers them on `localhost`, with a "Notify me" pill in the header, and shows no offer over the overlay VPN's plain HTTP, where a phone cannot get them.

### Keyboard

- j and k move the focus down and up the delegations, stopping at the ends; Enter opens the focused one; Esc closes the open delegation, or the list of keys first when it shows; / jumps to the search box; ? shows the keys. A key typed into a field, or pressed with Ctrl, Alt or Cmd, is left to the browser.

### A background tab

- The tab's title counts what is running (asking included) and what failed while the tab was hidden: "(2 running, 1 failed) Delegation tracker". Its icon gets a blue dot while something runs and a red one after an unseen failure, the red winning. Showing the tab clears the failures; failures already there when the page opened (the first list it receives) never count.

### On a phone

- One section at a time — the Delegations list, the Cluster figures or History — chosen in a bar at the bottom; Cluster has its own address `/cluster`, History `/history`.
- The list's header is "Delegations", with the live dot, the notification bell, the health pill only when something is wrong, and a Search button that shows the search box and the filters.
- The strip of cluster figures above the list links to the Cluster section, and is left out when there are no figures.
- An open delegation shows only its back link and itself.
- Long unbroken text (paths, commands, replies) wraps; nothing widens the page past the screen.
- A value cut to one line opens in full on a tap, since a phone has no hover for a tooltip.

### History

- On a wide screen a Delegation / History switch tops the main column; History takes the delegation's place there, and the list and the cluster figures stay.
- A range of 7, 30 or 90 of the viewer's local days, 30 to start. A run counts on the day it started; a run with no start time is left out.
- Five totals: delegations; done, the share that finished ok; did not finish, split into stopped, limits (timed out or cut off) and failed; tokens processed, input plus output; cache reuse, cached input over all input of the runs that report both. A total no run reports reads "—".
- Delegations per day stacked by outcome, and tokens per day stacked as input from cache, new input and output, each a column per day. Outcomes have their own softer chart colours, amber apart from red, checked for colour blindness. Hovering or focusing a day opens one card: the day, each series with its value, and the total.
- KV-cache use per day (peak as a bar, time-weighted average as a line, a dashed line at 90%, the highest peak named). Busy time comes from the run records, each run from its start for its time: the share of the range with at least one running, in busy and idle hours, the most at once and the average while busy, the busiest weekday hour, and a weekday-by-hour grid in local time shaded by how many ran at once on average. Days and cells open the same card as the day charts.
- Why runs did not finish: each reason with its outcome's icon and count, most first; "Every run finished." when there are none.
- By repo and by model: delegations, done, tokens, cache reuse, the median time, and the last start as 04-Oct-2026. A run without a repo or model groups as "—".
- Under it, how the records stand: how many are kept, when they were checked against the folder and how many disagreed, how many streams are gone, and any error saving them.

### Absent is not zero

- A missing figure shows `—` or nothing, never `0` or `0%`; a measured 0 shows as 0. This applies to cached tokens, reuse, tokens returned, load, effort, attempts, sizes, exit codes and tool time.
- Show `attempts` only when above 1, and a repeat share only at 15% or more. A turn whose reply repeats 15% or more of its lines (the stream's `duplicate_line_share`), or whose thinking repeats 30% or more of its lines (the stream's `reasoning_duplicate_line_share`, format 1.9; for older streams counted by the tracker over the joined partials' lines of 20 characters or more, from 5 such lines, because short lines such as braces and fences repeat without meaning a loop), carries an amber "reply repeats N%" / "thinking repeats N%" marker in its heading, and the details bar names the run's highest share and its turn.
- Omit the whole-run summary when none of its fields are present.
- Show the shell count only when above 0. Show the "thinking / answering" split only when `reasoning_chunks` is present.

### Tokens

- cached: for a finished stream, `end.cached_tokens`; for a running one, the sum over turns.
- reuse = cached ÷ prompt tokens sent, a share, never a running total.
- returned = what reached the caller. Blank until finished, then `end.output_tokens`, or else the last turn's.
- load = prompt + output summed over all turns: what the cluster processed.
- `tool_calls` is an integer (or `null`) on `end` and a list on `turn`: check the type before using it.

### A delegation as a conversation

- The task is the caller's message, on the right, with the files it was given or refused, and says which repo it came from when the stream names one. Each turn is the delegation's message, on the left: its tool calls as one compact row each, its text, and a line of its figures (tokens in and out, `turn.out_tok_s`, tool time), leaving out any it does not have. A finished run ends with a note saying it finished, failed, timed out or was stopped.
- Each turn is headed by the model, its number and when it started (its `priced` event's `at`); a call is one row: its name, its first argument's value and its figures joined by " · ", and it opens to show every argument in full. A call that names a `path` shows the file's name and the lines it read ("server.py · start 596 end 630", the whole path on hover), and lists `path`, `start_line` and `end_line` first, in that order, however the stream stored them; a call to ask_caller is not drawn when its question is shown; token counts are written short ("4.6k", "1.3M"). A file chip shows the path inside the repo on up to two lines when the stream names one, with the full path on hover and focus; a refused file is a chip marked "refused", with the reason in full under the chips. The end note says in one line how the run ended, how long it took, its turns and its cache use. "Jump to latest" is offered only while the run is going. Following watches and moves whatever scrolls the conversation: the detail pane on a desktop, the window on a phone.
- The conversation fills its pane. The caller's messages sit on the right, no wider than most of it; the delegation's turns sit on the left in bubbles of one width, most of the pane, so it is clear at a glance who speaks. A bubble shows its thinking, then its text, then its tool calls, the order the model writes them. Anything clickable shows the hand cursor. A turn's budget and evicted tool results sit behind a Turn details toggle at the end of its figures. A turn that took more than one attempt is marked "retried N×" in its heading; it opens to the recorded reasons in words, with how long the server waited before trying again, and counts the attempts the stream gives no reason for.
- A header stays on screen with the state, the title and a Details button. The details sit in a bar beside the conversation, a card that stays put from the first scroll, which the button folds away; the choice is remembered in the browser, and on a narrow desktop the bar starts folded. The bar holds the repo (when the stream names one), the kind, model, effort, start and time used; the turns as a bar; while the run is going, the time used as a bar from the newest heartbeat's `elapsed_seconds` of `of_seconds` with the time left, and the heartbeat; and the run's figures so far, including how many tool calls it made, how many failed, the cache hits and the retries. On a phone the same details fold open under the title. A run stopped mid-turn never closes that turn, so its old clock and heartbeat are not shown.
- A question to the caller shows in its turn as a highlighted message from the delegation, with "Waiting for an answer" and for how long (a pulsing dot) while the run waits, and "Answered after" how long once it has an answer; the caller's answer follows as the caller's message, saying which repo it came from when the stream names one and when the caller left the choice to the delegation (`best_reading`). When the stream says who answered (`answer.by`, format 1.10) it reads "You answered" for the person and "Caller answered" for the calling model; without it, "Answer". `question` and `answer` carry no turn number: they belong to the newest turn that has been priced.
- The task and every reply, as written and when done, render as Markdown. A code block's long lines wrap like the text around them, so no message scrolls sideways. Raw HTML in them shows as text and never runs; a link opens in a new tab with `noopener noreferrer`, and a `javascript:` link is not made clickable.
- The view follows the growing reply while the reader is at the bottom; scrolled up, it stays put and offers "Jump to latest". Clicking the delegation's title in its header scrolls back to the task at the top and stops following. No copy buttons.

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

- Every turn whose partials carried reasoning keeps it in a fold labelled with its length in characters. A finished turn's thinking is the partials' reasoning joined, fetched from `/api/streams/<name>/thinking/<turn>` only when the reader opens its fold, so a delegation's view stays small. From format 1.8 the turn's last partial is marked `final` and the joined partials are the whole thinking. Without a `final` partial, and when none of its partials carried reply text, the fold notes that the last moments of thinking may be missing, because a partial carries only the text since the previous one. When the stream says how long the turn reasoned (`turn.reasoning_seconds`, format 1.6), the label reads "Thought for 18s", and a turn without thinking text still says so as a plain line.
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
- Every state has its own icon besides its colour, the same in badges, cards and the conversation. A badge is a pill naming the state in a word: Running, Queued, Quiet, Done, Failed, Cut off. Every card is tinted in its state's colour, a run in progress (running, asking, queued) more strongly; a running card's dot pulses unless the system asks for reduced motion.
- Words in IBM Plex Sans. A figure, time, duration or piece of code that stands on its own is in IBM Plex Mono, with tabular digits so a ticking number keeps its width; one inside a sentence stays in the sentence's font.

## Run records

- A finished run becomes one record: when it started, its outcome and a short reason when it did not finish, its repo and model, how long it took, and its tokens. A failure's reason is its error's first sentence, with any word holding a digit written as N and cut to eight words, so one cause with different ids and timings counts as one. A missing figure stays null. A stream from before `start.workspace` gets its repo from the absolute paths it read: the parent folders of the repos other streams name are learned from their own paths, and a run whose paths all sit in one folder under such a parent takes that folder's name, marked as found this way. Paths under two repos, or none, leave it "—".
- The records live in `runs.json` in `DATA_DIR` (ADR-0005). The file is written to a temporary name and renamed over the old one, so a crash never leaves half a file. A file or a record of the wrong shape is ignored, never trusted.
- At every start the backend reads the whole folder once and compares each record with its stream. A record that disagrees is rebuilt from the stream and counted; a record whose stream is gone is kept and counted. The History tab shows both counts.
- Every `RUNS_SCAN_SECONDS` it re-reads only streams that are new or whose size changed.

## Security

- Exposure: the tracker listens on loopback. Only the overlay VPN's serve reaches it, so only devices on that private network can. It is never published to the internet.
- Host check: the tracker accepts only loopback Host names plus `ALLOWED_HOSTS`. That stops a page on another origin from reading it through DNS rebinding.
- Read-only: GET routes and SSE only. No write or control endpoints without a new design.
- File access: the backend opens only `*.jsonl` files it listed itself in `TRANSCRIPT_DIR`, read-only. A name from a URL is looked up in that list and never joined onto a path, so no request can name a file to open. The only files it writes are its own records in `DATA_DIR`, under names it chose itself.
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
