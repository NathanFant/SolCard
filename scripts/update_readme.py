#!/usr/bin/env python3
"""Auto-update README.md using the Claude API.

Gathers current project context (source files, docs, package.json) and
asks Claude to write a comprehensive, accurate README reflecting the
codebase as it stands right now — not tied to any specific commit.

Usage (called automatically by the pre-commit hook):
    python3 scripts/update_readme.py

If CLAUDE_API_KEY is absent the script exits cleanly without blocking
the commit.
"""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-sonnet-4-6"

# Source files whose full content is sent as context to Claude.
CONTEXT_FILES = [
    "package.json",
    "docs/architecture.md",
    "docs/card-flow.md",
    "CONTRIBUTING.md",
    "packages/api/src/index.ts",
    "packages/api/src/types/index.ts",
    "packages/api/src/routes/health.ts",
    "packages/api/src/routes/wallet.ts",
    "packages/api/src/routes/webhooks.ts",
    "packages/api/src/lib/escrow.ts",
    "packages/api/src/lib/solana.ts",
]

_SKIP_DIRS = {"node_modules", "dist", ".git", "__snapshots__"}


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


def file_tree() -> str:
    """Concise file listing of the repo, skipping generated dirs."""
    lines: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if any(s in path.parts for s in _SKIP_DIRS):
            continue
        if path.is_file():
            lines.append(str(path.relative_to(ROOT)))
    return "\n".join(lines)


def gather_context() -> str:
    """Build a single context string from key project files."""
    parts: list[str] = [
        "## Repository file tree\n```\n" + file_tree() + "\n```"
    ]
    for rel in CONTEXT_FILES:
        path = ROOT / rel
        if not path.exists():
            continue
        ext = path.suffix.lstrip(".")
        content = path.read_text().strip()
        parts.append(f"## {rel}\n```{ext}\n{content}\n```")
    return "\n\n".join(parts)


def _strip_outer_fence(text: str) -> str:
    """Remove wrapping ```markdown ... ``` if Claude adds it anyway."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
    return stripped


def call_claude(api_key: str, context: str) -> str:
    """Call the Claude Messages API and return the new README text."""
    current = (ROOT / "README.md").read_text()

    prompt = "\n".join([
        "You are maintaining the README.md for the SolCard project.",
        "",
        "Given the project files below, write a comprehensive README.md that:",
        "- Accurately describes what exists in the codebase right now",
        "- Marks planned/future items clearly (e.g. \"(planned)\")",
        "- Includes: project overview, how it works, tech stack, project",
        "  structure, getting started, API endpoints, a pointer to",
        "  CONTRIBUTING.md, and license",
        "- Uses the current README as a structural guide but updates",
        "  content to match the actual code and files",
        "- Is written for developers evaluating or onboarding to the project",
        "- Does NOT mention specific commits, recent changes, or version",
        "  history",
        "",
        "Current README:",
        "```markdown",
        current.strip(),
        "```",
        "",
        "Project files:",
        context,
        "",
        "Output ONLY the README.md markdown — no explanation, no outer",
        "code fence.",
    ])

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": 4096,
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
            "update_readme: CLAUDE_API_KEY not set"
            " — skipping README update"
        )
        return

    print("Updating README.md via Claude API...")
    try:
        readme = call_claude(api_key, gather_context())
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
        print(f"update_readme: API call failed ({exc}) — skipping")
        return

    (ROOT / "README.md").write_text(readme + "\n")
    print("README.md updated.")


if __name__ == "__main__":
    main()
