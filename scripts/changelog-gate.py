#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Deterministic floor for the changelog ledger (ADR-0016, issue #76).

Read-only: a failing run never writes the worktree, the target branch, or CHANGELOG.md.

  ticket  Ticket boundary. `HEAD` must be the single squashed commit; its subject must be
          conventional and project exactly one well-formed entry.
  ledger  Ledger checks. The `## [Unreleased]` block must pass well-formedness, section
          integrity, duplicate-identity, placeholder, and provenance checks, and no PR may
          have produced more entries than it had commits. On `main` every entry must resolve
          to a landing commit; at the PR boundary pass `--pr`/`--landing`, and that PR is
          covered by its declared landing instead. Unattributed entries recorded in `--baseline`
          are tolerated debt, and the baseline may only shrink.

Exit codes: 0 pass · 1 blocked/fixable · 2 blocked/needs human.

Usage:
  uv run scripts/changelog-gate.py ticket [--base main]
  uv run scripts/changelog-gate.py ledger [--changelog CHANGELOG.md]
  uv run scripts/changelog-gate.py ledger --pr 96 --landing squash
  uv run scripts/changelog-gate.py ledger --pr 96 --landing merge --base main
  uv run scripts/changelog-gate.py ledger --update-baseline   # seed or shrink the debt record
  uv run scripts/changelog-gate.py ledger --waiver "reason recorded in the PR body"
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Protocol, cast

GENERATOR = Path(__file__).resolve().with_name("changelog-unreleased.py")


class _Generator(Protocol):
    """The generator surface this gate depends on.

    The sibling is loaded by path — its filename carries a dash, so it is not importable as a
    module — which leaves every `GEN.` access `Any`. Declaring the seam keeps the gate checked and
    records the coupling: both scripts ship together, and a test pins the scaffolded copy
    byte-for-byte against the canonical one.
    """

    UNRELEASED_HEADING: str
    TYPE_SECTIONS: dict[str, tuple[str, bool]]
    SECTION_HEADING_RE: re.Pattern[str]
    VERSION_HEADING_RE: re.Pattern[str]
    BULLET_RE: re.Pattern[str]
    CONVENTIONAL_RE: re.Pattern[str]

    run: Callable[[list[str]], str]
    entry_identity: Callable[[str], str]
    parse_unreleased_sections: Callable[[str], dict[str, list[str]]]
    commits_to_sections: Callable[[list[tuple[str, str]]], dict[str, list[str]]]


def _load_generator() -> ModuleType:
    """Import the sibling generator so the gate shares its grammar and identity rule.

    `changelog-unreleased.py` owns the conventional-commit table, the section names, the
    `(#N)`-stripping identity rule, and the commit-log parser. Re-deriving any of them here
    would let the check and the renderer disagree, which is the failure this gate exists to
    stop.
    """
    spec = importlib.util.spec_from_file_location("changelog_unreleased", GENERATOR)
    if spec is None or spec.loader is None:  # pragma: no cover - importlib guarantees both
        raise RuntimeError(f"cannot load {GENERATOR}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


GEN = cast(_Generator, cast(object, _load_generator()))

# The renderer writes `* `, an optional `**scope:** `, then the subject. Anything else is
# not something `changelog-unreleased.py update` could have produced.
ENTRY_RE = re.compile(r"^\* (?:\*\*[^*]+:\*\* )?\S")
SCOPED_RE = re.compile(r"^\* \*\*[^*]+:\*\* \S")
SCOPE_RE = re.compile(r"^\* \*\*(?P<scope>[^*]+):\*\*")
EMPTY_BULLET_RE = re.compile(r"^[*+-]\s*$")
PLACEHOLDER_RE = re.compile(r"\bTBD\b|\bTODO\b|<[^>]+>")
# Curation appends the landing PR; the generator's identity rule strips it again.
ATTRIBUTION_RE = re.compile(r"\(#(?P<pr>\d+)\)\s*$")
PR_REF_RE = re.compile(r"#(\d+)")
KNOWN_SECTIONS = frozenset(section for section, _ in GEN.TYPE_SECTIONS.values())
# The migration's record of entries that predate attribution. Shrink-only: growth needs a
# human, not a flag, so `--update-baseline` refuses to add a line.
DEFAULT_BASELINE = Path(".config/changelog-unattributed-baseline.txt")
BASELINE_NOTE = (
    "# Unattributed ledger entries allowed by ADR-0016's migration. Shrink-only: delete a line",
    "# when its entry gains (#N) or is removed; never add one.",
)


@dataclass(frozen=True)
class Finding:
    """One failed check. `fixable` separates "edit the ledger" from "a human must look"."""

    check: str
    detail: str
    fixable: bool = True


def unreleased_block(content: str) -> str | None:
    """The `## [Unreleased]` body, up to the next version heading. None when absent."""
    if GEN.UNRELEASED_HEADING not in content:
        return None
    _, rest = content.split(GEN.UNRELEASED_HEADING, 1)
    version = GEN.VERSION_HEADING_RE.search(rest)
    return rest[: version.start()] if version else rest


def check_sections(block: str) -> list[Finding]:
    """The block parses, carries only known sections, and puts every entry under one."""
    findings: list[Finding] = []
    current: str | None = None
    seen: set[str] = set()
    for line in block.splitlines():
        heading = GEN.SECTION_HEADING_RE.match(line)
        if heading:
            name = heading.group("name")
            if name in seen:
                findings.append(Finding("section-integrity", f"duplicate heading '### {name}'"))
            seen.add(name)
            if name not in KNOWN_SECTIONS:
                findings.append(
                    Finding(
                        "section-integrity",
                        f"unknown section '### {name}' — this ledger's sections are the "
                        + f"conventional-commit types: {', '.join(sorted(KNOWN_SECTIONS))}",
                    )
                )
            current = name
            continue
        if GEN.BULLET_RE.match(line) and current is None:
            findings.append(
                Finding("section-integrity", f"entry outside any section: {line.strip()!r}")
            )
    return findings


def check_entries(block: str) -> list[Finding]:
    """Every entry matches the renderer's bullet grammar and carries no placeholder."""
    findings: list[Finding] = []
    for line in block.splitlines():
        text = line.rstrip()
        if EMPTY_BULLET_RE.match(text):
            findings.append(Finding("well-formedness", f"empty bullet: {text!r}"))
            continue
        if not GEN.BULLET_RE.match(text):
            continue
        if not ENTRY_RE.match(text) or (text.startswith("* **") and not SCOPED_RE.match(text)):
            findings.append(
                Finding("well-formedness", f"not in the renderer's bullet grammar: {text!r}")
            )
        if PLACEHOLDER_RE.search(text):
            findings.append(Finding("placeholders", f"placeholder text: {text!r}"))
    return findings


def check_duplicates(sections: dict[str, list[str]]) -> list[Finding]:
    """No two entries share an identity, using the generator's `(#N)`-stripping rule."""
    findings: list[Finding] = []
    seen: set[str] = set()
    for entries in sections.values():
        for entry in entries:
            identity = GEN.entry_identity(entry)
            if identity in seen:
                findings.append(
                    Finding("duplicate-identity", f"duplicate entry identity: {identity!r}")
                )
            seen.add(identity)
    return findings


def attributed_pr(entry: str) -> str | None:
    """The `#N` an entry names as the PR that landed it, or None.

    Curation appends it (ADR-0016) and `entry_identity` strips it, so identity and
    attribution stay independent.
    """
    match = ATTRIBUTION_RE.search(entry.rstrip())
    return match.group("pr") if match else None


def _count(raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        return 0


def landing_commits() -> dict[str, int]:
    """`#N` -> how many commits that PR contributed to HEAD.

    A squash landing is one commit carrying `(#N)`; a merge landing carries `#N` in the
    merge subject, and its second-parent range is the PR's own commits. Both are permanent:
    no network, no branch refs. Merge subjects are read deliberately — `--no-merges` would
    hide exactly the commits a merge landing rests on.
    """
    raw = GEN.run(["git", "log", "HEAD", "--pretty=format:%s%x00%P%x1e"])
    landings: dict[str, int] = {}
    for record in raw.split("\x1e"):
        record = record.strip()
        if not record:
            continue
        subject, _, parents = record.partition("\x00")
        refs = [m.group(1) for m in PR_REF_RE.finditer(subject)]
        if not refs:
            continue
        parent_list = parents.split()
        for ref in refs:
            if ref in landings:
                continue
            if len(parent_list) > 1:
                landings[ref] = _count(
                    GEN.run(["git", "rev-list", "--count", f"{parent_list[0]}..{parent_list[1]}"])
                )
            else:
                landings[ref] = 1
    return landings


def unattributed(entries: list[str]) -> set[str]:
    """Identities of entries that name no PR — the migration's debt class."""
    return {GEN.entry_identity(entry) for entry in entries if attributed_pr(entry) is None}


def read_baseline(path: Path) -> set[str] | None:
    """The recorded debt, or None when there is no baseline file."""
    if not path.exists():
        return None
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }


def write_baseline(path: Path, entries: list[str], existing: set[str] | None) -> list[Finding]:
    """Seed the baseline, or shrink it. Growth is reported, never recorded.

    Shrinking has to work in a tree that also carries new unattributed entries — the normal
    state before a PR's curation — so the write happens and the additions come back as findings
    instead of blocking it.
    """
    present = unattributed(entries)
    findings: list[Finding] = []
    if existing is None:
        recorded = present
    else:
        recorded = existing & present
        additions = sorted(present - existing)
        if additions:
            findings.append(
                Finding(
                    "baseline",
                    f"{len(additions)} unattributed entry(s) not recorded, e.g. {additions[0]!r}: "
                    + "they need (#N) attribution, not a baseline line",
                    fixable=False,
                )
            )
    # A header-only file is the terminal state: it tolerates nothing, and unlike a deleted file it
    # stages cleanly in release tooling that globs assets rather than staging removals.
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join([*BASELINE_NOTE, *sorted(recorded)]) + "\n", encoding="utf-8")
    return findings


def check_baseline(entries: list[str], baseline: set[str] | None) -> list[Finding]:
    """A baseline may only shrink: a line whose entry is gone is authority waiting to be reused."""
    if baseline is None:
        return []
    stale = sorted(baseline - unattributed(entries))
    if not stale:
        return []
    return [
        Finding(
            "baseline",
            f"{len(stale)} baseline line(s) no longer match an unattributed entry, "
            + f"e.g. {stale[0]!r}; --update-baseline shrinks it",
        )
    ]


def check_provenance(
    entries: list[str],
    landings: dict[str, int],
    current_pr: str | None,
    baseline: set[str] | None = None,
) -> list[Finding]:
    """Every entry names a PR, and that PR's landing commit is reachable from HEAD.

    An identity recorded in the baseline is tolerated debt: it predates attribution, and the
    baseline may only shrink. Anything else unattributed is growth, and fails.
    """
    findings: list[Finding] = []
    for entry in entries:
        ref = attributed_pr(entry)
        identity = GEN.entry_identity(entry)
        if ref is None:
            if baseline is not None and identity in baseline:
                continue
            findings.append(Finding("provenance", f"entry carries no (#N): {identity!r}"))
        elif ref == current_pr:
            continue
        elif ref not in landings:
            findings.append(
                Finding(
                    "provenance",
                    f"(#{ref}) resolves to no commit reachable from HEAD: {identity!r}",
                )
            )
    return findings


def check_attribution(
    entries: list[str],
    landings: dict[str, int],
    current_pr: str | None,
    current_allowance: int | None,
) -> list[Finding]:
    """`entries(#N) <= commits(#N)`, per PR.

    The aggregate of the landing delta, on one basis: attribution. A violation names the PR
    that over-produced. This counts; it never deletes, so the rejected reachability pruning
    is not implicated.
    """
    counts: Counter[str] = Counter(ref for ref in (attributed_pr(e) for e in entries) if ref)
    findings: list[Finding] = []
    for ref in sorted(counts):
        allowance = current_allowance if ref == current_pr else landings.get(ref)
        if allowance is None:
            continue  # check_provenance already reported it
        if counts[ref] > allowance:
            findings.append(
                Finding("accounting", f"#{ref}: {counts[ref]} entries > {allowance} commits")
            )
    return findings


def check_ledger(
    changelog: Path,
    base: str | None = None,
    landing: str | None = None,
    pr: str | None = None,
    baseline_path: Path = DEFAULT_BASELINE,
    update_baseline: bool = False,
) -> list[Finding]:
    """The ledger checks. Reads; never writes.

    Without `--pr`/`--landing` this is the durable, main-side run: every entry must resolve
    to a landing commit. With them it is the PR-boundary run — entries attributed to `--pr`
    are covered by its declared landing instead, because that PR has not landed yet.
    """
    if not changelog.exists():
        return [Finding("ledger", f"{changelog} is missing", fixable=False)]
    try:
        content = changelog.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        return [Finding("ledger", f"{changelog} is not UTF-8: {error}", fixable=False)]

    block = unreleased_block(content)
    if block is None:
        return [Finding("section-integrity", f"no '{GEN.UNRELEASED_HEADING}' block to check")]

    findings = check_sections(block) + check_entries(block)
    sections = GEN.parse_unreleased_sections(content)
    findings += check_duplicates(sections)
    entries = [entry for group in sections.values() for entry in group]
    baseline = read_baseline(baseline_path)
    if update_baseline:
        return write_baseline(baseline_path, entries, baseline)
    findings += check_baseline(entries, baseline)

    if not GEN.run(["git", "rev-parse", "--verify", "--quiet", "HEAD"]):
        return findings + [
            Finding("accounting", "no commits reachable from HEAD; cannot evaluate", fixable=False)
        ]

    allowance: int | None = None
    if pr is not None and landing == "squash":
        allowance = 1
    elif pr is not None and landing == "merge":
        if base is None:
            return findings + [
                Finding(
                    "landing",
                    "--landing merge needs --base to count the PR's commits",
                    fixable=False,
                )
            ]
        counted = GEN.run(["git", "rev-list", "--count", f"{base}..HEAD"])
        if not counted.isdigit():
            return findings + [
                Finding("landing", f"cannot count commits in {base!r}..HEAD", fixable=False)
            ]
        allowance = _count(counted)

    landings = landing_commits()
    findings += check_provenance(entries, landings, pr, baseline)
    findings += check_attribution(entries, landings, pr, allowance)

    if (
        pr is not None
        and landing == "squash"
        and not any(attributed_pr(entry) == pr for entry in entries)
    ):
        findings.append(
            Finding("landing", f"a squash landing carries exactly one entry; #{pr} carries none")
        )
    return findings


def default_base() -> str | None:
    """The merge target: `origin/HEAD` when it exists, else `main`, else `master`."""
    head = GEN.run(["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
    if head:
        return head.removeprefix("refs/remotes/")
    for candidate in ("main", "master"):
        if GEN.run(["git", "rev-parse", "--verify", "--quiet", f"{candidate}^{{commit}}"]):
            return candidate
    return None


def check_ticket(base: str) -> list[Finding]:
    """The ticket-boundary check: one squashed commit, conventional, one well-formed entry."""
    if not GEN.run(["git", "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}"]):
        return [Finding("ticket-state", f"base ref {base!r} does not resolve", fixable=False)]
    count = GEN.run(["git", "rev-list", "--count", f"{base}..HEAD"])
    if not count.isdigit():
        return [Finding("ticket-state", f"cannot count commits ahead of {base!r}", fixable=False)]
    if count != "1":
        return [
            Finding(
                "ticket-state",
                f"{count} commits ahead of {base!r}; the merge boundary expects exactly one",
                fixable=False,
            )
        ]

    subject = GEN.run(["git", "log", "-1", "--pretty=%s"])
    body = GEN.run(["git", "log", "-1", "--pretty=%b"])
    if not GEN.CONVENTIONAL_RE.match(subject):
        return [Finding("conventional-subject", f"not a conventional subject: {subject!r}")]

    projected = [
        entry
        for entries in GEN.commits_to_sections([(subject, body)]).values()
        for entry in entries
    ]
    if len(projected) != 1:
        return [
            Finding(
                "single-entry",
                f"subject projects {len(projected)} entries, expected exactly one: {subject!r}",
            )
        ]
    entry = projected[0]
    if not ENTRY_RE.match(entry) or (entry.startswith("* **") and not SCOPED_RE.match(entry)):
        return [Finding("well-formedness", f"projected entry is not well-formed: {entry!r}")]
    return []


def exit_code(findings: list[Finding]) -> int:
    if not findings:
        return 0
    return 2 if any(not finding.fixable for finding in findings) else 1


class _Args(Protocol):
    """The CLI surface, declared so `argparse`'s `Namespace` stops leaking `Any`."""

    check: str
    base: str | None
    pr: str | None
    landing: str | None
    changelog: str
    baseline: str
    update_baseline: bool
    waiver: str | None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic changelog-ledger floor (ADR-0016)")
    _ = parser.add_argument("check", choices=["ticket", "ledger"], help="which boundary to check")
    _ = parser.add_argument("--changelog", default="CHANGELOG.md", help="path to CHANGELOG.md")
    _ = parser.add_argument(
        "--base", default=None, help="base ref: the merge target, or the PR's target"
    )
    _ = parser.add_argument("--pr", default=None, help="this PR's number, for the PR-boundary run")
    _ = parser.add_argument("--landing", choices=["squash", "merge"], default=None)
    _ = parser.add_argument(
        "--baseline", default=str(DEFAULT_BASELINE), help="recorded unattributed identities"
    )
    _ = parser.add_argument("--update-baseline", action="store_true", help="seed or shrink it")
    _ = parser.add_argument(
        "--waiver",
        default=None,
        help="recorded reason to accept fixable findings; never rescues a needs-human one",
    )
    args = cast(_Args, cast(object, parser.parse_args(argv)))

    if args.check == "ticket":
        base = args.base or default_base()
        if base is None:
            findings = [
                Finding("ticket-state", "cannot resolve a base branch; pass --base", fixable=False)
            ]
        else:
            findings = check_ticket(base)
    elif args.pr is not None and args.landing is None:
        findings = [Finding("landing", "--pr needs --landing (the declaration)", fixable=False)]
    else:
        findings = check_ledger(
            Path(args.changelog),
            args.base,
            args.landing,
            args.pr,
            Path(args.baseline),
            args.update_baseline,
        )

    if args.waiver is not None and not args.waiver.strip():
        findings = [Finding("waiver", "--waiver needs a written reason", fixable=False)]

    waived: list[Finding] = []
    blocking: list[Finding] = []
    for finding in findings:
        (waived if args.waiver and finding.fixable else blocking).append(finding)
    for finding in waived:
        print(f"[waived] [{finding.check}] {finding.detail}", file=sys.stderr)
    for finding in blocking:
        print(f"[{finding.check}] {finding.detail}", file=sys.stderr)
    if args.waiver:
        print(f"waiver recorded: {args.waiver.strip()}", file=sys.stderr)
    if not blocking:
        print(f"{args.check}: pass" + (" (waived)" if waived else ""))
    return exit_code(blocking)


if __name__ == "__main__":
    sys.exit(main())
