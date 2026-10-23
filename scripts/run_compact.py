#!/usr/bin/env python3
"""Run a command while keeping routine validation output compact."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


ANSI_ESCAPE = re.compile(r"\x1b(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
IMPORTANT = re.compile(
    r"(?:\bFAILED\b|\bFAIL(?:URE)?\b|\bERROR\b|\bError:|\bAssertionError\b|"
    r"\bExpected\b|\bReceived\b|\bpanic\b|\bexception\b|\bnot ok\b|^E\s{2,})",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a command and print only a bounded failure summary.",
    )
    parser.add_argument("--max-lines", type=int, default=80)
    parser.add_argument("--context", type=int, default=2)
    parser.add_argument("--tail-lines", type=int, default=20)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command:
        parser.error("provide a command after --")
    if args.max_lines < 1 or args.context < 0 or args.tail_lines < 0:
        parser.error("line limits must be non-negative and --max-lines must be positive")
    return args


def clean(line: str) -> str:
    return ANSI_ESCAPE.sub("", line.rstrip("\r\n"))


def select_excerpt(lines: list[str], context: int, tail_lines: int, limit: int) -> list[str]:
    selected: set[int] = set()
    for index, line in enumerate(lines):
        if IMPORTANT.search(line):
            start = max(0, index - context)
            end = min(len(lines), index + context + 1)
            selected.update(range(start, end))

    if tail_lines:
        selected.update(range(max(0, len(lines) - tail_lines), len(lines)))

    ordered = sorted(selected)
    if not ordered:
        ordered = list(range(max(0, len(lines) - limit), len(lines)))

    excerpt: list[str] = []
    previous: int | None = None
    for index in ordered:
        if len(excerpt) >= limit:
            break
        if previous is not None and index > previous + 1:
            excerpt.append("...")
            if len(excerpt) >= limit:
                break
        excerpt.append(lines[index])
        previous = index
    return excerpt[:limit]


def main() -> int:
    args = parse_args()
    log_file = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        prefix="luxledger-qa-",
        suffix=".log",
        delete=False,
    )
    log_path = Path(log_file.name)
    recent_lines: deque[str] = deque(maxlen=max(args.max_lines, args.tail_lines, 1))

    try:
        process = subprocess.Popen(
            args.command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = clean(raw_line)
            log_file.write(line + "\n")
            recent_lines.append(line)
        return_code = process.wait()
    except FileNotFoundError:
        missing = args.command[0]
        log_file.write(f"Command not found: {missing}\n")
        recent_lines.append(f"Command not found: {missing}")
        return_code = 127
    except KeyboardInterrupt:
        return_code = 130
    finally:
        log_file.close()

    command_text = shlex.join(args.command)
    if return_code == 0:
        log_path.unlink(missing_ok=True)
        print(f"SUCCESS: {command_text}")
        return 0

    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = list(recent_lines)

    excerpt = select_excerpt(lines, args.context, args.tail_lines, args.max_lines)
    print(f"FAILURE: {command_text} (exit {return_code})")
    print(f"Full log: {log_path}")
    if excerpt:
        print("Relevant output:")
        print("\n".join(excerpt))
    return return_code


if __name__ == "__main__":
    sys.exit(main())
