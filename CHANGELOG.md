<!-- BUDGET-PER-ENTRY: 60 -->
# Changelog

Newest first, **one section per pull request**, headed `## #<PR> — <date> — <PR title>`.
The heading carries the pull request's own title, so a section can be found from either.

Under each, the subsections `Added`, `Changed` and `Fixed`, in that order. A subsection with
nothing in it is left out. Each entry gives the **why**: the symptom, the cause, the fix.

**A merged section is never edited afterwards.** A correction is a new section.

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
