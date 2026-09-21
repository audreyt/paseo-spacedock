"""Forward path of the e-ink gate intake: gate -> spine -> HTML -> PDF -> outbox.

1. Runs sibling project-gate.py (front-matter binding + room index.json
   + stage-def Gate content -> bilingual spine.md).
2. Renders HTML with a Lantern-compatible renderer (default: ~/prep/lantern.py).
3. Prints a Move-portrait PDF with headless Chrome and drops it in OUTBOX.

The reMarkable reads OUTBOX via Dropbox/Drive sync; annotated pages come back
through INBOX, where the first officer reads the decision and runs
`spacedock gate record --decision ... --actor person:captain` (return path).

Usage:
  remarkable-intake.py <workflow-dir> <entity> --recommend approve|reject
      [--reason TEXT] [--gloss gloss.json] --outbox DIR
      [--lantern PATH] [--keep-html] [--chrome PATH]
  remarkable-intake.py inbox --dir DIR [--since STATE]
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p


def forward(argv):
    wf, slug = argv[0], argv[1]
    rest = argv[2:]
    if "--outbox" not in rest:
        raise SystemExit("missing --outbox DIR")
    outbox = Path(rest[rest.index("--outbox") + 1])
    outbox.mkdir(parents=True, exist_ok=True)
    lantern = Path(rest[rest.index("--lantern") + 1] if "--lantern" in rest
                   else Path.home() / "prep" / "lantern.py")
    chrome = (rest[rest.index("--chrome") + 1] if "--chrome" in rest else
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    keep_html = "--keep-html" in rest
    passthrough = [a for a in rest
                   if a not in ("--keep-html",)]
    # strip intake-only flags before passing to project-gate.py
    for flag, nargs in (("--outbox", 1), ("--lantern", 1), ("--chrome", 1)):
        while flag in passthrough:
            i = passthrough.index(flag)
            del passthrough[i:i + 1 + nargs]

    work = outbox / f".{slug}-gate-work"
    work.mkdir(exist_ok=True)
    spine = work / "gate-spine.md"
    run([sys.executable, str(HERE / "project-gate.py"), wf, slug,
         *passthrough, "-o", str(spine)])
    html = work / "gate-spine-lantern.html"
    run([sys.executable, str(lantern), str(spine), "--verify", "--force"],
        cwd=lantern.parent)
    assert html.exists(), "renderer did not emit HTML"
    pdf = outbox / f"{slug}-gate.pdf"
    run([chrome, "--headless", "--no-sandbox", "--disable-gpu",
         f"--print-to-pdf={pdf}", "--no-pdf-header-footer",
         f"file://{html}"])
    if keep_html:
        html.rename(outbox / f"{slug}-gate.html")
    print(f"gate PDF: {pdf}")
    return str(pdf)


def inbox(argv):
    rest = argv
    d = Path(rest[rest.index("--dir") + 1])
    state = Path(rest[rest.index("--since") + 1]) if "--since" in rest else None
    seen = set(json.loads(state.read_text())) if state and state.exists() else set()
    current = sorted((p.name for p in d.iterdir() if p.is_file()
                      and not p.name.startswith(".")))
    new = [n for n in current if n not in seen]
    for n in new:
        print(f"RETURNED: {n}")
        print(f"  read the captain's marks, then e.g.:")
        print(f"  spacedock gate record <entity> --decision approve|revise|hold "
              f"--actor person:captain [--reason TEXT] [--consume] "
              f"--workflow-dir <dir>")
    if state:
        state.write_text(json.dumps(current))
    if not new:
        print("inbox: no new returns")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "inbox":
        inbox(sys.argv[2:])
    else:
        forward(sys.argv[1:])


if __name__ == "__main__":
    main()
