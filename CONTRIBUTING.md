<!-- BUDGET: 220 -->

# Contributing

This is a public repo. What you write here is read by anyone. The code, docs, commits and PRs
are public. Private files — `CLAUDE.local.md`, `.env`, the node key — stay out of git.

## Where work lives

Open work, its context and its sub-steps are tracked outside this repo. Only commits, PRs and
docs here are public. A PR body names the planned item it delivers with one `Closes` line per
planned item.

## Commits and pull requests

Every commit subject and PR title follows [Conventional Commits](https://www.conventionalcommits.org).
The type is one of `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

- One feature per PR.
- Squash-merge, and delete the branch.
- One PR is open at a time. `scripts/plan_stack.py` publishes the front branch of a local stack;
  the next one after it merges.
- Before anything is pushed or published, show the full commit and PR text and get approval.
- Branch names are `feat/<slug>`, `fix/<slug>` or `docs/<slug>`; the gate checks the type on
  both the commit subject and the pull request title.
- Write the **why** in the commit body, not just the what: the symptom that prompted the change,
  the cause, and the fix.
- `main` requires a pull request and green checks.

## CHANGELOG

`CHANGELOG.md` is newest first, one section per PR, headed `## #<PR> — <date> — <PR title>`, with
the subsections `Added`, `Changed` and `Fixed` in that order. Leave out an empty subsection. Each
entry gives the why: the symptom, the cause and the fix. A merged section is never edited; a
correction is a new section.

The PR body is that CHANGELOG section plus a `### Verification` section: what failed before the
fix, and the test results. The CHANGELOG carries no issue numbers: its heading's PR number leads
to the PR.

## Tests

Write the test first, run it against the unfixed code, and keep its failure. A test that passes
before the fix is blind. Every check gets a negative control: a test proving it fires on a real
violation.

The layers, in order:

- **Contract tests:** every vendored sample passes the vendored schema; every sample runs through
  the state builder without error; a fake future-minor sample (an unknown field and an unknown
  kind) is tolerated; a fake future-major sample (`format: "2.0"`) raises the banner.
- **Rendering-rule tests:** one per rule in the stream rendering rules.
- **Folder-reader tests:** on a temporary folder: a half-written last line, a character split
  across two reads, a line longer than one read, a file that shrank, a name without the stamp,
  and a newest-by-name pick whose order changes.
- **Metrics tests:** on made-up Prometheus text, never a real capture. Cover a counter reset, the
  first scrape, and unknown names being ignored.
- **API tests:** the routes, through the app's test client.
- **Page tests:** component tests with Vitest; browser tests later.

Run the TypeScript tests with Vitest. Run the Python gate tests with pytest, under `tests/gate`.

## Docs

Each kind of content has one home:

| Content | Home |
|---|---|
| Open work, its context and its sub-steps | tracked outside this repo |
| How it works now | `docs/ARCHITECTURE.md` |
| How work is done | this file |
| What shipped, and why | `CHANGELOG.md` |
| A finding that will matter long after the item closes | `JOURNAL.md` |
| Why we chose X over Y, when the choice outlives one issue | `DECISIONS.md` |
| Anything about your machines, devices or identity | `CLAUDE.local.md` |

`DECISIONS.md` holds numbered decision records (ADRs), newest first, the headings as the index. A
decision's body is never edited; when it stops being true, only its heading changes, to say what
replaced it. The four ADRs so far are ADR-0001 (languages), ADR-0002 (what the tracker relies on
from the server), ADR-0003 (node figures over SSH with a restricted key) and ADR-0004 (who may
open the page).

The bar for an ADR is high: a structural decision, one that shapes how the tracker is built and
would be costly to reverse. Everything else has another home:

- a tuned value (an interval, a timeout, a threshold): a JOURNAL entry with its measurement;
- a choice that matters only inside one item: a note on that planned item;
- how something works now: `docs/ARCHITECTURE.md`.

`JOURNAL.md` holds what took real work to find out, or would surprise you again in six months,
usually a measurement and what it settled. Newest first, each entry headed
`## <date> — <the finding in one line>`.

**Keeping docs small:**

- A line budget per doc, checked on every commit. A doc that hits its budget is trimmed, or split
  for a different reader.
- One fact, one home. Other docs link to it rather than restate it.
- Docs say what *is*. History lives in the CHANGELOG and PRs; open work is tracked outside this
  repo, never in docs.
- Code that goes takes its docs with it, in the same PR.
- Each code file has one owning doc, and changing the file means updating that doc.
  `python scripts/docs_gate.py --owner <path>` says which.

## Prose

What each kind of text may hold. These rules live here; everything else links to them.

- **A comment, a docstring and a product document describe what is**, as briefly as keeps
  each reason. History goes to `CHANGELOG.md` or `JOURNAL.md`; a design's reason to an ADR,
  linked in one line.
- **A BUDGET header holds only its number.** Exceeding it blocks and **never means delete**:
  trim your own additions first, split for a valid reason, or, last, raise it to the next
  multiple of ten with the reason in the commit message.
- **The vendored schema and samples are contract**: editing them is a behaviour change.
- **Write the mechanism, never the specimen.** Cite a source line as "file line N", never as a
  file name, a colon and the number: once the number has four digits, the scanner reads that as
  a host and a port, and blocks it.

## Repo machinery

`scripts/docs_gate.py` is the gate: a Python script, standard library only, run by the hooks and
by CI. It checks identity, e-mail, conflict markers, host identifiers, public text, doc budgets,
owning docs, ADRs, CHANGELOG numbers and commit messages. Install the hooks with
`python scripts/install_hooks.py`. Gitleaks scans for secrets; its config is generated by
`scripts/gen_gitleaks_config.py`.

The hooks run the gate on every commit. CI runs four jobs on every pull request and on `main`:
the gate, lint (ESLint and `tsc`), tests (Vitest, then the gate's pytest suite) and a gitleaks
secret scan. `main` requires all four by job name (`.github/ruleset.json`), so renaming a job
means editing the ruleset in the same PR. Action pins are full commit SHAs.

A check that fails can be waived with a commit-message trailer
`Docs-Gate-Skip: <check> -- <reason>`; every run echoes it. Use it for a real exception; spent
on a limitation the gate names as its reason to block, it buys nothing.

The gate scans the code and docs too. `.env.example` holds placeholders only. The real `.env`
and `CLAUDE.local.md` are gitignored.

**Screenshots.** A screenshot of the tracker shows real task text, replies and node names, and a
browser address bar can show this machine's name on the overlay VPN. Take them only of the
tracker running on the sample streams in `contract/`, never on live data, and check each by eye
before it is committed or attached.

## Updating the contract

The contract is the JSON Schema and the sample streams vendored from a server release into
`contract/`, with a `VERSION` file naming the release. Only `scripts/update-contract.ts` changes
it. Run it with `npm run update-contract`; it downloads the schema and the samples, runs the
contract tests, and prints what changed.

Ship an update in a PR of its own, for every new server release. A minor version never breaks the
tracker (unknown fields and kinds are skipped), so it is not urgent. A major version comes before
anything else.
