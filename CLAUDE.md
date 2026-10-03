<!-- BUDGET: 120 -->

# Traps for anyone editing this repo

Read CLAUDE.local.md alongside this file. It holds the private facts (machines, identities,
how planned work is tracked) and is read first wherever they matter.

## Public and private
- Public: code, docs, commits, PRs.
- Private, never public: CLAUDE.local.md, .env, security/forbidden_strings.txt, the node SSH key.
- Planned work is tracked outside this repo, privately. Text quoted from it into a commit, a
  PR or a doc is public, and is checked like any other public text.
- Nothing public holds a host literal, a machine/user/home name, an address, or the VPN
  product's name. Name things by role: "a cluster node", "the phone", `C:\Users\<you>`.
- Real identifiers go in CLAUDE.local.md and each also into security/forbidden_strings.txt,
  so the gate catches them if they slip into public text.
- Screenshots show real task text, replies and node names. Take them only of the tracker
  running on the sample streams in contract/, never on live data, and check each by eye first.

## Repo machinery
- Write the mechanism, never the specimen: say what a rule does, don't copy one instance.
- Cite a source line as "file line N", never as the file name, a colon and the number. Once the
  number has four digits the scanner reads that as a host and a port.
- .env.example holds placeholders only.
- The docs gate runs from the first commit and on every push. It scans the code extensions
  too, and skips package-lock.json in the host scan (public registry URLs only).
- A blocking budget means trim your own additions first, never delete others' text to fit.
  What a comment, an ADR or a budget raise may hold is CONTRIBUTING.md's "Prose" section.

## The contract
- contract/ is vendored from a server release. Only scripts/update-contract.ts writes it.
- Never read a field the contract does not have.
- Ignore what you don't know, and never treat it as an error: an unknown field leaves the rest
  of the event usable, an unknown event kind is left out, and an unknown major version raises
  a banner and renders best-effort.
- Absent is not zero: a missing figure shows `—`, a measured 0 shows 0.

## File access and security
- A name from a URL is never joined onto a path. The backend looks up a name in the list it
  listed itself, and opens only *.jsonl files it found, read-only.
- Accept only loopback Host names plus ALLOWED_HOSTS; anything else is refused, so a page on
  another origin cannot read it through DNS rebinding.
- GET routes and SSE only, no CORS headers, no write or control endpoints.
- The node key is dedicated and can run only the stats command; keep it outside the repo.

## Settings
- Defaults live only in src/server/settings.ts, never in docs or tests.

## Tests
- The delegation sandbox has no Node: delegations draft and read; the session runs the tests.
- Never run two test suites at once (memory pressure).
- Red before green: write the test first and keep its failure. Every check gets a negative
  control proving it fires on a real violation.
- Every rendering rule in docs/ARCHITECTURE.md becomes a test.
- A check that cannot fail is worse than no check, because it is trusted. Watch a check that
  finds its own needle — the reference it validates, the pattern list that defines it — reads
  stale state, or reads the wrong copy. Negative-test every check, tests included.

## Docs
- Structural decisions live in DECISIONS.md as ADR-0001..ADR-0004; cite ADRs, never the
  internal spec's ids. One fact, one home.
- Every file under src/, scripts/, .github/ and .claude/ has exactly one owning document, or is
  declared unowned. Changing the code means updating its owning document in the same commit,
  and the gate blocks otherwise. Don't copy the mapping — ask the gate which document owns a file.
- A fact belongs to exactly one document and one plane: the repo root is the project plane
  (where we are, why), docs/ the product plane (how it works). Explaining a default in prose? Link.
- Blocked by the gate and right anyway? Add a `Docs-Gate-Skip: <check> -- <reason>` trailer. It
  is echoed in every run; two on one document soon after each other signal the document, not
  the rule.
- ADR bodies are never edited; a superseded decision changes only its heading.

## Git and publishing
- Conventional Commits; one feature per PR; squash-merge; one PR open at a time.
- CHANGELOG.md, newest first, one section per PR; a merged section is never edited.
- Before anything is pushed or published, show the full commit and PR text and get approval.
- No attribution trailers in commits, ever; don't ask.
- One feature per commit: code, tests, docs and CHANGELOG together — it gives the owning-document
  check something to compare against.
- CHANGELOG entries carry the why: the symptom, the cause, the fix.

## Identity
- Check `git config user.name` shows the project's public identity before a first commit.
  Where that identity comes from is in CLAUDE.local.md.

## Delegations
- Delegations write first drafts and do the reading. Investigate a failure; don't just rerun.
- Delegated prose runs over budget; keep it short.
- grep cannot prove a conclusion absent. Verify by measuring, not by reasoning.
