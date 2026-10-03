"""Two bugs where a safety mechanism silently validated nothing.

Both were found by negative-testing the gate rather than by reading it, and both share a
shape worth naming: the check ran, reported success, and could not have failed. That is
worse than an absent check, because an absent check is not trusted.

Named after the bugs, per the project's testing convention.
"""

from __future__ import annotations

import re
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "scripts" / "docs_gate.py"

sys.path.insert(0, str(ROOT / "scripts"))

import docs_gate  # noqa: E402  -- needs the path line above


def _run(script: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=ROOT, capture_output=True, text=True,
    )


# ---------------------------------------------------------------------------
# Bug 1: a supersede reference validated against the whole file, so the
# reference satisfied itself and the check could never fire.
# ---------------------------------------------------------------------------

def _adr_check(text: str) -> list[str]:
    """Drives the gate's own check over synthetic headings.

    This used to reimplement the rule, for hermeticity: `check_adr_format` read
    DECISIONS.md and nothing else, so exercising it meant mutating a tracked file. The
    cost was that these tests validated a copy -- they would pass whether or not the real
    check still worked, which is the exact shape this file is named after. The function
    now takes its text as an argument, so the copy is gone and these drive the real thing.
    """
    problems = []
    for finding in docs_gate.check_adr_format(text):
        if (m := re.search(r"ADR-(\d{4}) points at ADR-(\d{4})", finding.message)):
            problems.append(f"ADR-{m.group(1)} -> ADR-{m.group(2)}")
    return problems


def _adr_malformed(text: str) -> list[str]:
    """The headings the gate rejected outright, as opposed to dangling references."""
    return [
        f.message for f in docs_gate.check_adr_format(text) if "malformed" in f.message
    ]


def test_supersede_pointing_at_a_nonexistent_adr_is_caught():
    """The bug: searching the file text for "ADR-0099" always succeeded, because the
    heading being validated contains that string itself."""
    text = textwrap.dedent("""
        ## ADR-0002 — 2026-08-24 — Later thing — Accepted

        ## ADR-0001 — 2026-08-24 — Earlier thing — Superseded by ADR-0099
    """)
    assert _adr_check(text) == ["ADR-0001 -> ADR-0099"]


def test_supersede_pointing_at_a_real_adr_passes():
    text = textwrap.dedent("""
        ## ADR-0002 — 2026-08-24 — Later thing — Accepted

        ## ADR-0001 — 2026-08-24 — Earlier thing — Superseded by ADR-0002
    """)
    assert _adr_check(text) == []


def test_a_struck_through_heading_still_counts_as_declared():
    """A superseded ADR remains a valid target for an even later one, so the
    declared-set must include struck-through headings."""
    text = textwrap.dedent("""
        ## ADR-0003 — 2026-08-24 — Newest — Accepted

        ## ~~ADR-0002 — 2026-08-24 — Middle~~ — Superseded by ADR-0003

        ## ADR-0001 — 2026-08-24 — Oldest — Superseded by ADR-0002
    """)
    assert _adr_check(text) == []


def test_a_heading_may_name_more_than_one_successor():
    """ADR-0005 was overtaken twice, on different clauses, and must be able to say so."""
    text = textwrap.dedent("""
        ## ADR-0003 — 2026-08-24 — Newest — Accepted

        ## ADR-0002 — 2026-08-24 — Middle — Accepted

        ## ADR-0001 — 2026-08-24 — Oldest — Partially superseded by ADR-0002 and ADR-0003
    """)
    assert _adr_malformed(text) == []
    assert _adr_check(text) == []


def test_every_reference_in_a_heading_is_validated_not_just_the_first():
    """The trap the widened grammar opens, and the reason this test exists at all.

    The reference check used `re.search`, which stops at one match. Admitting a list
    without widening the lookup would leave the second and later targets unvalidated --
    the first reference real, the rest anything at all, and the gate silent. That is the
    same shape as the two bugs above: a check that runs, reports success, and cannot fail.
    """
    text = textwrap.dedent("""
        ## ADR-0002 — 2026-08-24 — Later thing — Accepted

        ## ADR-0001 — 2026-08-24 — Earlier — Partially superseded by ADR-0002 and ADR-0099
    """)
    assert _adr_check(text) == ["ADR-0001 -> ADR-0099"]


def test_a_list_of_successors_is_still_a_grammar_not_free_text():
    """Widening is not the same as opening. A status the gate cannot parse must still
    block, or the heading stops being an index."""
    text = textwrap.dedent("""
        ## ADR-0002 — 2026-08-24 — Later thing — Accepted

        ## ADR-0001 — 2026-08-24 — Earlier — Superseded by ADR-0002 and also some others
    """)
    assert _adr_malformed(text), "an unparseable status must still be rejected"


def test_the_real_decisions_file_has_no_dangling_supersede_references():
    text = (ROOT / "DECISIONS.md").read_text(encoding="utf-8")
    assert _adr_check(text) == []


# ---------------------------------------------------------------------------
# Bug 2: the generator compared a committed doc against a CACHED compile of
# the source, so a same-length edit inside one timestamp tick was invisible.
# ---------------------------------------------------------------------------

def test_gate_also_avoids_the_cached_compile_trap():
    assert "pycache_prefix" in GATE.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Bug 4: the commit-identity check flagged GitHub's own synthetic merge commit,
# which would have blocked every pull request permanently.
# ---------------------------------------------------------------------------

def test_identity_check_ignores_merge_commits():
    """For a pull_request event, Actions checks out a merge commit that GitHub authors
    itself as noreply@github.com. It is not a contribution, and checking it would refuse
    every pull request forever -- a gate that blocks everything is as useless as one that
    blocks nothing."""
    src = GATE.read_text(encoding="utf-8")
    ident = src[src.index("def check_commit_identity"):src.index("def check_emails_in_files")]
    assert '"--no-merges"' in ident, (
        "the identity check must exclude merge commits; see the CI failure on PR #1"
    )


def test_author_allowlist_and_content_allowlist_are_not_the_same_policy():
    """Conflating them broke both directions.

    A service address must never be able to author a commit, but must be mentionable in a
    comment. Merging the lists forced a choice between a false positive on prose and a
    hole in the identity check.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("dg", GATE)
    dg = importlib.util.module_from_spec(spec)
    # Register before executing: the @dataclass decorator resolves its own module via
    # sys.modules, and fails opaquely on a module that is not there yet.
    sys.modules[spec.name] = dg
    try:
        spec.loader.exec_module(dg)
    finally:
        sys.modules.pop(spec.name, None)

    authors = set(dg.load_lines(ROOT / "security" / "allowed_emails.txt"))
    assert "noreply@github.com" not in authors, (
        "a service address must not be allowed to author commits"
    )
    assert "noreply@github.com" in dg.content_safe_emails(), (
        "a service address must be mentionable in file content"
    )
    assert authors, "the author allowlist must not be empty"


def test_gitleaks_allowlist_is_generated_not_hand_maintained():
    """CONTRIBUTING once said the gate's list and gitleaks' list "must stay in step".

    They drifted within an hour: the gate was fixed for a false positive and gitleaks was
    not, and CI caught it. A hand-maintained invariant between two files is the thing this
    project replaces with a generator, so it now is one.
    """
    proc = _run(ROOT / "scripts" / "gen_gitleaks_config.py", "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr

    text = (ROOT / ".gitleaks.toml").read_text(encoding="utf-8")
    assert "GEN:EMAILS:START" in text and "GEN:EMAILS:END" in text
    for addr in ("noreply@github", "ComputerSaysNull"):
        assert addr in text, f"{addr} missing from the generated allowlist"
