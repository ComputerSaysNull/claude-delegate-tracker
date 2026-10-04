<!-- BUDGET-PER-ENTRY: 60 -->
# Changelog

Newest first, **one section per pull request**, headed `## #<PR> — <date> — <PR title>`.
The heading carries the pull request's own title, so a section can be found from either.

Under each, the subsections `Added`, `Changed` and `Fixed`, in that order. A subsection with
nothing in it is left out. Each entry gives the **why**: the symptom, the cause, the fix.

**A merged section is never edited afterwards.** A correction is a new section.

## #21 — 2026-10-04 — feat: put the list and the open delegation side by side

### Changed

- **On a wide screen the list sits on the left and the open delegation on the right**,
  with the model server and nodes in a band across the top. The page was one 576 px
  column in the middle of the screen, and opening a delegation loaded a new page that
  hid the list. A row now opens in place; a click with a modifier key still opens a new
  tab, and an old `/s/<name>` address still opens its delegation. A phone shows one pane
  at a time.

## #20 — 2026-10-04 — fix: hide the sparklines' axes and follow the container's width

### Fixed

- **Chart lines overlapped their times and ran outside the chart.** The sparkline passed
  uPlot an empty axes list to mean "no axes", but uPlot fills an empty list with its default
  x and y axes, so every 32 px chart drew a time axis and a value axis over its line and
  squeezed the plot. Both axes are now hidden one by one. The chart was also drawn at its
  first width only; it now redraws when its container's width changes.

## #19 — 2026-10-04 — feat: one colour palette, an icon per state, and IBM Plex served by the tracker

### Changed

- **Every colour is a named token, light and dark, in `index.css`.** Each view picked its
  own Tailwind colours, with a dark partner per class, so the same meaning had several
  shades. A test reads the tokens and computes text contrast on the page, a card and the
  state's own tint: six light colours came out under 4.5:1 and were darkened. Another
  test refuses a colour named anywhere else; it replaces the dark-variant scan.
- **Each state has its own icon besides its colour**, and running and queued cards are
  tinted. States differed by colour alone, and badges showed the stream's own codes
  ("live", "ok"); a badge is now a pill with a word: Running, Done, Cut off.
- **IBM Plex Sans for words, Plex Mono with tabular digits for figures.** The font was
  whatever the system had, and ticking numbers jiggled. Both are bundled from Fontsource,
  so the page asks no other host.

## #18 — 2026-10-04 — feat: write dates as 12 Nov and times on a 24-hour clock

### Changed

- **Dates read "12 Nov 19:00", with the year only when it is not this year.** The page
  left the format to the browser's locale, which gave "Nov 12, 07:00 PM" and "7:00:00 PM".
  The formatter now writes day, short month and a 24-hour clock itself, in the viewer's
  zone, so it reads the same in every browser.

## #17 — 2026-10-04 — chore: vendor the contract from server v0.7.0

### Changed

- **The contract moves from v0.6.0 to v0.7.0, transcript format 1.1 to 1.4.** The server
  now writes a caller's title in `start`, `question` and `answer` events, and `end.ended`,
  but the tracker may read only what its vendored contract has. Only additions, so a
  minor. A new sample, `asked_the_caller.jsonl`, joins the others; the tracker still
  leaves the new kinds out until it shows them.

## #16 — 2026-10-04 — feat: chart the cluster figures over time

### Added

- **Small charts under the figures**: requests running, KV-cache use and decode speed for
  the model server, and CPU and GPU use and temperature for each node, over the last
  `HISTORY_WINDOW_SECONDS`. A single reading said little about whether the cluster was
  getting busier or cooling down. A missing figure is a gap, never 0, and an outage shows
  as a break in the line rather than a line joined across it.
- **`GET /api/cluster/history`**: the backend keeps a point per reading in memory, so a
  restart starts the charts afresh; the page fetches it once and adds each live update.

## #15 — 2026-10-04 — feat: search and filter the delegations shown

### Added

- **Search and filters over the list**: words from the title (all of them, any order),
  state, kind and model, applied to the live rows and any older pages loaded, with how many
  of the loaded rows are shown and a Clear button. Finding one delegation meant scrolling
  through cards. The filtering runs in the page over what is loaded; it reads no more files.

## #14 — 2026-10-04 — feat: start the tracker at logon without a manual command

### Added

- **`scripts/autostart.ps1`**: registers a Task Scheduler entry that starts the tracker at
  every logon, with no window, using the repo's `.env`. Until now it ran only after
  someone remembered `npm start`. `-Stop` stops the tracker it started, because ending
  the scheduled task alone leaves the server running underneath it; `-Remove` also removes
  the entry. A tracker started by hand is never touched.

## #13 — 2026-10-03 — feat: page back through older delegations beyond the newest 20

### Added

- **"Show older"** under the list: the next 20 delegations, then the next, until the oldest.
  Until now only the newest 20 were reachable, though the folder holds over a thousand.
  Older pages are read on request and never polled, so the live list costs no more.
- **`GET /api/streams?before=<name>`**: the page after a name the backend listed itself;
  any other name is `404` and is never joined onto a path.

## #12 — 2026-10-03 — feat: show every time in local time, in dark and light themes

### Changed

- **One local-time formatter for the whole page**: each view formatted its own times, so a
  new view could slip back to UTC unnoticed (streams carry UTC). They now all go through
  one module, and a test fails if a view formats a time itself.
- **Dark and light themes, held to it**: the page follows the system setting, and a test
  now fails if any colour lacks its dark-mode variant, which is how a view ends up
  unreadable in one of the two.

## #11 — 2026-10-03 — feat: make every view fit and read well on a phone

### Fixed

- **Pages wider than a phone screen**: measured at 360 px, the list was 404 px wide
  because a long title no longer truncated once it became a link, and a delegation's page
  was 1,859 px wide because paths, commands and replies hold long unbroken strings. Long
  text now wraps anywhere it must, and the title truncates again.
- **Cut values out of reach on a phone**: long arguments and file paths were cut with `…`
  and the rest only shown in a hover tooltip, which a phone cannot open. A cut value now
  opens in full on a tap.

## #10 — 2026-10-03 — fix: close the page's live connections when you leave it

### Fixed

- **Pages stalled on "Loading…" after a few visits**: going from the list to a delegation
  and on to the next, the fourth page never loaded. The browser keeps a page you leave in
  its back/forward cache, and with it that page's live connections; over HTTP/1.1 it allows
  six per host, so after three pages there was none left. The page now closes its live
  connections when it is hidden, and reloads when it comes back from that cache.

## #9 — 2026-10-03 — feat: warn on the page when what it shows can't be trusted

### Added

- **Health banners** at the top of every page: the transcript folder not set or not
  readable (with when it is tried next), the model server or a node unreachable, a node
  refused for its host key, a stream in a contract major this tracker does not know, events
  that failed the schema, names without the timestamp prefix, lines that were not JSON, and
  a clock skew over 5 s between WSL and Windows. Until now most of these were counted or
  logged but never shown, so the page could look fine while showing stale or wrong ages.
- **The runtime schema check**: every event is checked against the vendored schema and a
  failure is counted, never dropped. **Clock skew** is measured on lines that appeared
  since the previous read, so an old file's first read says nothing about the clocks.

### Changed

- **The folder is retried after 1, 2, 4 … 30 s** while it can't be read, instead of at the
  normal interval, and the health report now arrives as a `health` event on
  `/api/updates` rather than by the page asking every 5 s. The list's own "can't be read"
  note moved into the banners, so the fact is shown once.

## #8 — 2026-10-03 — feat: show each cluster node's load and temperature

### Added

- **The node panel** on the list page: for each node, CPU use with the window it was
  measured over, CPU temperature, GPU use and GPU temperature, and when they were read.
  Until now a node's load and heat meant logging in to it. Figures come over SSH with the
  dedicated key that can run only the stats command, on one connection per node kept open.
  The CPU temperature is the hottest thermal zone, since the nodes name none for the CPU.
- **Pinned host keys**: a node whose host key does not match `NODE_KNOWN_HOSTS` is refused
  and its panel says so, because the SSH library accepts any host key unless told
  otherwise, and a fake node could feed the panel invented figures. A node that can't be
  reached keeps the time of its last good reading, and each node fails alone.

## #7 — 2026-10-03 — feat: show the model server's load in a panel on the page

### Added

- **The model server panel** on the list page: requests running and waiting, KV-cache use,
  decode speed with the window it was measured over, the prefix-cache hit rate since the
  engine started, and preemptions when there are any, with the time the figures were read.
  Until now, how busy the cluster was could only be read off the server's raw metrics.
  A figure that is missing shows `—`, a measured 0 shows 0; a counter that went down (the
  engine restarted) and a first reading give no rate. An unreachable server says since
  when there are no figures, and a `404` reads as "not available", not as idle.
- **`GET /api/cluster`** and a `cluster` event on `/api/updates`. Only the seven allowlisted
  metric names are read, label values never leave the backend, and a token, if any, stays
  in its own environment variable (`METRICS_TOKEN_ENV`). Read every `METRICS_POLL_SECONDS`.

## #6 — 2026-10-03 — feat: show the reply growing while the model writes it

### Added

- **The reply as it is written**: on a delegation's page, the open turn's answer grows as
  the model writes it, with its reasoning folded away until opened. Until now the reply
  appeared only when the turn ended, so a long answer looked like a stall. When the turn
  ends, its final text replaces the growing one, because a retried attempt can leave text
  behind that never reached the reply. Each live update carries only the added text, so a
  long answer is not resent every second.

## #5 — 2026-10-03 — feat: follow one delegation on its own page, updating live

### Added

- **A page per delegation** at `/s/<name>`, opened from its title in the list: the task in
  full, the files it was given or refused, then each turn with its budget line, its tool
  calls (every argument, the outcome, a refusal in full, result size, exit code, time) and
  its reply, then the run's summary and any error. Until now a delegation was a black box
  until its reply landed.
- **Live counters, not lines**: while a turn runs, its heartbeat (chunks, time since the
  last chunk, the countdown) and the running tools' status update in place, and a queued
  wait is one line that keeps the newest total.
- **`GET /api/streams/<name>`** and **`/api/updates?stream=<name>`**: the whole view, then
  only the turns that changed. Each patch is numbered, so the page refetches the whole view
  after a reconnect or a skipped number instead of drifting. A followed stream is read
  every `FOLLOW_POLL_SECONDS` and kept while a page has it open. A name is looked up among
  the names the folder listing returned, never joined onto a path, so any listed stream
  opens, old ones too, and nothing else does.

## #4 — 2026-10-03 — feat: show the delegation list on the page, updating live

### Added

- **The delegation list on the page**: one card per delegation, newest first, with a
  coloured state badge, the title, then kind, model, effort, turns and elapsed time, the
  start time in local time, the quiet or queued age, and why a stream failed or was cut off.
  A missing piece is left out, never shown as `null` or `0`. The page says when the list is
  capped, and when the folder can't be read (the last list stays). Cards stack on a phone.
- **Live updates** over Server-Sent Events at `/api/updates`: the whole list on connect,
  then again on every change, and a `: ping` comment every 15 s so a proxy keeps the
  connection open. The browser reconnects by itself, and the first event after that is the
  whole list again, so nothing is replayed. A lost connection shows a note and keeps the
  last list.

## #3 — 2026-10-03 — feat: derive the delegation list from the transcript folder

### Added

- **`GET /api/streams`**: the newest 20 delegations, newest first by `start.at`, each with its
  state, why (for cut off and failed), age (for quiet and queued), kind, model, effort,
  title, start time, elapsed time and turns used of budget. It also says when the list is
  capped, how many streams the folder holds, how many names lack the stamp, whether the
  folder was readable, and how many lines were not JSON. The page does not show it yet.
- **The folder reader**: picks the newest 25 names without opening a file, then reads each
  stream from a byte offset, keeping whole lines only. A half-written last line waits for
  its newline, a character split between reads is never decoded in halves, a line longer
  than one read comes back whole, and a file that shrank is read again from the start.
- **The state builder**: the six states in the order the rendering rules give, so a failed
  stream is never shown as cut off, a finished one never goes quiet, and a silent queued one
  reads as quiet. Unknown fields and event kinds change nothing; an unknown format major is
  flagged. Ages and durations stop at `0s`, so a WSL clock slightly ahead of Windows never
  shows a negative time.
- **The poller**: one reader per listed stream; a finished stream is never read again; the
  last rows are kept when the folder cannot be read; listeners hear only real changes. Its
  interval counts from the end of the previous pass, so passes never overlap.
- **Titles** from the task's first line, cut to 60 characters at a space.
- **Settings** `QUIET_AFTER_SECONDS` and `STREAMS_POLL_SECONDS`.

## #2 — 2026-10-03 — feat: serve a first page on loopback, with the Host check and a health route

### Added

- **`npm start`** builds the page and starts the backend on `127.0.0.1` only. Until now there
  was nothing to open, so nothing else (the phone, the list, the panels) could be tried.
- **The Host check**: a request whose `Host` is not a loopback name or in `ALLOWED_HOSTS` gets
  `403` before any route runs. Without it, a page on another site could read the tracker
  through DNS rebinding.
- **GET only**: any other method gets `405`. The tracker reads; it has no route that changes
  anything.
- **`/api/health`**: whether the transcript folder is set and readable, never its path.
- **The page**: shows that health, refreshed every 5 s, in local time, in light and dark
  themes, readable on a phone. A missing value shows `—`, and a lost backend shows a banner
  while the last values stay.
- **Settings** (`TRACKER_PORT`, `TRANSCRIPT_DIR`, `ALLOWED_HOSTS`) from the environment and
  `.env`. A bad `TRACKER_PORT` stops the start with a message naming it.

## #1 — 2026-10-03 — chore: add the CI workflow and the main branch ruleset

### Added

- **CI on every pull request and on `main`**, four jobs: the docs and secrets gate, lint
  (ESLint and `tsc`), tests (Vitest, then the gate's own pytest suite) and a gitleaks secret
  scan. The hook runs the gate on commit; CI is the copy `--no-verify` cannot skip. Action
  pins are fresh: the server's pins target a Node runtime GitHub is removing.
- **`.github/ruleset.json`** for `main`: pull requests only, squash-merge only, and the four
  jobs above required by name. A renamed job blocks every pull request until the ruleset is
  edited too.
