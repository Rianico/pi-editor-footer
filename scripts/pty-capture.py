#!/usr/bin/env python3
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Capture a TUI under a real interactive pty.

Why this exists: `script -q /tmp/x.log pi ... </dev/null` gives pi a terminal whose
stdin is already at EOF, so pi renders **its own** editor and the capture silently
documents pi's chrome instead of this extension's. Every claim about our rows,
separators, frame or working indicator needs this helper.

Usage:
    uv run scripts/pty-capture.py OUT --cols 100 --rows 24 --send-at 8 --send 'hi\\r' -- pi --no-session -e src/index.ts

Then read the screen with a VT emulator (absolute cursor addressing, erase-to-EOL,
alternate screen) rather than grepping the byte stream — pi redraws in place, so
raw text repeats and interleaves.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Capture a command's TUI output under a pty.")
    parser.add_argument("out", help="file to write the raw pty stream to")
    parser.add_argument("--cols", type=int, default=120, help="terminal width (default 120)")
    parser.add_argument("--rows", type=int, default=40, help="terminal height (default 40)")
    parser.add_argument("--send-at", type=float, default=8.0, help="seconds to wait before typing")
    parser.add_argument("--send", default="", help="payload to type (escape sequences allowed)")
    parser.add_argument("--timeout", type=float, default=26.0, help="hard stop in seconds")
    # Split on the first standalone `--` ourselves: argparse's REMAINDER swallows the
    # options that precede it, so the command would carry our own flags.
    split = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:split])
    command = argv[split + 1 :]
    if not command:
        parser.error("no command given (use -- cmd args...)")

    payload = args.send.encode().decode("unicode_escape").encode("latin-1", "ignore")

    pid, fd = pty.fork()
    if pid == 0:  # child
        # SAFETY: pty child — exec the argv array we were handed (no shell, no
        # interpolation); this is the documented `pty.fork()` pattern, and the parent
        # never runs the command itself.
        os.execvp(command[0], command)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))

    chunks: list[bytes] = []
    started = time.time()
    sent = False
    while time.time() - started < args.timeout:
        if not sent and payload and time.time() - started >= args.send_at:
            try:
                os.write(fd, payload)
            except OSError:
                break
            sent = True
        readable, _, _ = select.select([fd], [], [], 0.2)
        if not readable:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        chunks.append(data)

    for closing in (b"\x03", b"\x1b"):
        try:
            os.write(fd, closing)
            time.sleep(0.3)
        except OSError:
            break
    with contextlib.suppress(ProcessLookupError):
        os.kill(pid, 9)

    blob = b"".join(chunks)
    try:
        with open(args.out, "wb") as handle:
            handle.write(blob)
    except OSError as error:
        print(f"cannot write {args.out}: {error}", file=sys.stderr)
        return 1
    print(f"captured {len(blob)} bytes -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
