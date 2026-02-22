#!/usr/bin/env python3
"""Auto-update CHANGELOG.md using the Claude API.

On each commit, reads the staged diff summary and recent git history,
then asks Claude to add concise bullet points to the [Unreleased]
section. Bullets are short — one line per logical change.

The CD workflow (cd.yml) stamps [Unreleased] with the release version
and resets the section to empty on every merge to main.

Usage (called automatically by the pre-commit hook):
    python3 scripts/update_changelog.py

Exits cleanly without blocking the commit if CLAUDE_API_KEY is absent
or the API call fails.
"""

import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-sonnet-4-6"
CHANGELOG = ROOT / "CHANGELOG.md"


def load_env() -> dict[str, str]:
    """Load variables from .env then .env.local (.env.local wins)."""
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        path = ROOT / name
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def _run(cmd: list[str]) -> str:
    result = subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True
    )
    return result.stdout.strip()


def staged_summary() -> str:
    """Files changed in the current staged commit."""
    return _run(["git", "diff", "--cached", "--stat"])


def recent_commits() -> str:
    """Commits since last tag, or last 10 if no tags exist."""
    last_tag = _run(["git", "describe", "--tags", "--abbrev=0"])
    if last_tag:
        return _run(["git", "log", f"{last_tag}..HEAD", "--oneline"])
    return _run(["git", "log", "--oneline", "-10"])


def ensure_changelog() -> str:
    """Return current CHANGELOG content, creating it if missing."""
    if not CHANGELOG.exists():
        CHANGELOG.write_text(
            "# Changelog\n\n"
            "All notable changes to SolCard are documented here.\n"
            "Entries are short — one line per logical change.\n\n"
            "## [Unreleased]\n"
        )
    return CHANGELOG.read_text()


def _strip_outer_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
    return stripped


def call_claude(api_key: str, current: str, context: str) -> str:
    """Ask Claude to add concise bullets to [Unreleased]."""
    prompt = "\n".join([
        "You are maintaining CHANGELOG.md for the SolCard project.",
        "Format follows Keep a Changelog (keepachangelog.com).",
        "",
        "Given the staged file summary and recent commits below, update",
        "the [Unreleased] section with concise bullet points for this",
        "commit. Rules:",
        "- Each bullet is one short sentence (max ~80 chars)",
        "- Start each bullet with a verb: Add, Fix, Update, Remove, etc.",
        "- Do not duplicate bullets already present in [Unreleased]",
        "- Do not add or modify version headers — only edit [Unreleased]",
        "- Do not include dates, authors, or commit hashes",
        "- Skip trivial housekeeping (whitespace fixes, comment typos)",
        "",
        "Current CHANGELOG.md:",
        "```",
        current.strip(),
        "```",
        "",
        "Context (staged changes + recent commits):",
        context,
        "",
        "Output ONLY the complete updated CHANGELOG.md — no explanation.",
    ])

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return _strip_outer_fence(data["content"][0]["text"])


def main() -> None:
    env = load_env()
    api_key = env.get("CLAUDE_API_KEY") or os.environ.get(
        "CLAUDE_API_KEY", ""
    )
    if not api_key:
        print(
            "update_changelog: CLAUDE_API_KEY not set"
            " — skipping changelog update"
        )
        return

    staged = staged_summary()
    if not staged:
        # Nothing staged — no meaningful entry to add
        return

    current = ensure_changelog()
    commits = recent_commits()
    context = (
        f"Staged changes:\n{staged}\n\nRecent commits:\n{commits}"
    )

    print("Updating CHANGELOG.md via Claude API...")
    try:
        updated = call_claude(api_key, current, context)
        updated = _strip_outer_fence(updated)
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
        print(f"update_changelog: API call failed ({exc}) — skipping")
        return

    CHANGELOG.write_text(updated + "\n")
    print("CHANGELOG.md updated.")


if __name__ == "__main__":
    main()
