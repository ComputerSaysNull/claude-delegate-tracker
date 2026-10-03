<!-- BUDGET-PER-ENTRY: 60 -->
# Changelog

Newest first, **one section per pull request**, headed `## #<PR> — <date> — <PR title>`.
The heading carries the pull request's own title, so a section can be found from either.

Under each, the subsections `Added`, `Changed` and `Fixed`, in that order. A subsection with
nothing in it is left out. Each entry gives the **why**: the symptom, the cause, the fix.

**A merged section is never edited afterwards.** A correction is a new section.

## #1 — 2026-10-03 — chore: add the CI workflow and the main branch ruleset

### Added

- **CI on every pull request and on `main`**, four jobs: the docs and secrets gate, lint
  (ESLint and `tsc`), tests (Vitest, then the gate's own pytest suite) and a gitleaks secret
  scan. The hook runs the gate on commit; CI is the copy `--no-verify` cannot skip. Action
  pins are fresh: the server's pins target a Node runtime GitHub is removing.
- **`.github/ruleset.json`** for `main`: pull requests only, squash-merge only, and the four
  jobs above required by name. A renamed job blocks every pull request until the ruleset is
  edited too.
