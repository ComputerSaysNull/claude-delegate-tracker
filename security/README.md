# security/

Machine-checkable safety lists. Deliberately small.

| File | Consumed by | Purpose |
| --- | --- | --- |
| `allowed_emails.txt` | `scripts/docs_gate.py`, `scripts/gen_gitleaks_config.py` | The only addresses permitted as a commit author/committer or inside a tracked file |
| `content_safe_emails.txt` | `scripts/docs_gate.py`, `scripts/gen_gitleaks_config.py` | Addresses that may appear in file content but not as an author |
| `forbidden_strings.txt` | `scripts/docs_gate.py` | **Untracked, local only.** Identifying literals -- see below |

## Why `forbidden_strings.txt` is not committed

It holds literal identifiers: host names, addresses, user names, paths. A committed file
listing the strings you do not want committed is itself the leak it is trying to prevent.

It lives here untracked, and CI reads the same content from a repository secret. Two
independent layers keep it out: `.gitignore`, and the gate's `never-track` check, which
refuses it even if `.gitignore` is edited or `git add -f` is used. One layer is one edit
away from nothing.

The committed backstop is a set of *patterns* -- private and CGNAT address ranges,
`host:port` shapes, and short-hostname forms -- which catch the class without naming the
instance. Those patterns are necessarily visible, so they narrow what kind of network is
being defended against; they do not reveal which one.

## Setting the CI secret

The gate reads one literal per line, so a multi-line secret works directly:

```bash
gh secret set FORBIDDEN_STRINGS -R ComputerSaysNull/claude-delegate-tracker < security/forbidden_strings.txt
```

Comments and blank lines are ignored, so the file can be piped in as-is. Update the secret
whenever the file changes -- nothing checks that they agree, because nothing in CI is
allowed to see the file.
