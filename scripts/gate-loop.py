# Public domain under CC0 1.0. See LICENSE and PATENTS.md.
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

"""Automatic return path for the e-ink gate intake.

Watches INBOX for annotated gate PDFs and turns the captain's marks into a
`spacedock gate record` decision:

1. Extract typed PDF annotation contents with pypdf.
2. If no annotations, render page 1 and read marks with a vision reader
   (default: local Splash OpenAI-compatible chat completions with image_url;
   `ollama` + a vision-capable model is the fallback).
3. Parse an unambiguous decision (approve | revise | hold + reason).
4. With --auto-record, execute `gate record --actor person:captain`
   (--consume on approve) — annotation reads only. VLM reads always draft
   for human confirmation, because a rasterized page cannot distinguish
   printed prompt text from handwritten marks.
5. Move processed files to DONE so the loop is idempotent.

Present-gate "reject" maps to record "revise" (bounce back with findings).

Usage:
  gate-loop.py --inbox DIR --workflow-dir DIR [--entity SLUG]
      [--auto-record] [--reader splash|ollama] [--reader-url URL]
      [--reader-model MODEL] [--since STATE] [--done DIR]
"""
import json
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

APPROVE = ["批准", "同意", "准", "approve", "approved", "lgtm"]
REVISE = ["退回", "修改", "改", "revise", "reject", "rejected", "打回"]
HOLD = ["hold", "待定", "稍等", "等等"]


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p


def pdf_marks(pdf):
    """Typed annotation contents via pypdf. Page print text is outbound
    content, not captain marks, so it is never read here. Returns "" when
    pypdf is missing or the file carries no annotations."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    r = PdfReader(str(pdf))
    out = []
    for page in r.pages:
        for annot in (page.get("/Annots") or []):
            a = annot.get_object()
            if a.get("/Contents"):
                out.append(str(a["/Contents"]))
    return "\n".join(out)


READ_PROMPT = """Read the handwritten or typed marks on this gate-review page.
The captain writes one decision: approve (批准/同意), revise (退回/修改),
or hold (待定/等等), optionally with a short reason.
Reply in exactly this shape, nothing else:
DECISION: approve|revise|hold|unclear
REASON: <one line, or "-" >
""".strip()


def render_page(pdf):
    td = tempfile.mkdtemp()
    run(["pdftoppm", "-png", "-r", "150", "-f", "1", "-l", "1",
         str(pdf), f"{td}/p"])
    return f"{td}/p-1.png"


def vlm_read(pdf, reader, url, model):
    img = render_page(pdf)
    if reader == "splash":
        return splash_api(img, url, model or splash_first_model(url))
    if reader == "ollama":
        return ollama_api(img, model or "gemma4:12b-nvfp4")
    raise SystemExit(f"unknown --reader {reader}")


def _post_json(url, payload, timeout=240):
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def splash_first_model(url):
    import urllib.request
    with urllib.request.urlopen(url + "/v1/models", timeout=15) as r:
        d = json.loads(r.read())
    return d["data"][0]["id"]


def splash_api(img, url, model):
    import base64
    b64 = base64.b64encode(Path(img).read_bytes()).decode()
    d = _post_json(url + "/v1/chat/completions", {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": READ_PROMPT},
            {"type": "image_url",
             "image_url": {"url": "data:image/png;base64," + b64}},
        ]}],
        "max_tokens": 1024,
        "stream": False,
    })
    return d["choices"][0]["message"]["content"] or ""


def ollama_api(img, model):
    import base64
    b64 = base64.b64encode(Path(img).read_bytes()).decode()
    d = _post_json("http://127.0.0.1:11434/api/generate", {
        "model": model,
        "prompt": READ_PROMPT,
        "images": [b64],
        "stream": False,
    })
    return d["response"]


def parse_decision(text):
    m = re.search(r"DECISION:\s*(approve|revise|hold|unclear)", text)
    r = re.search(r"REASON:\s*(.+)", text)
    if m and m.group(1) != "unclear":
        return m.group(1), (r.group(1).strip() if r else "-")
    low = text.lower()
    hits = {d: [w for w in words if w.lower() in low]
            for d, words in (("approve", APPROVE), ("revise", REVISE),
                             ("hold", HOLD))}
    found = [d for d, w in hits.items() if w]
    if len(found) == 1:
        return found[0], "parsed from marks"
    return "unclear", "-"


def entity_for(name, override):
    if override:
        return override
    m = re.match(r"(.+?)-gate(?:\.annotated)?\.pdf$", name)
    if not m:
        raise SystemExit(f"cannot derive entity from {name}; pass --entity")
    return m.group(1)


def main():
    rest = sys.argv[1:]
    inbox = Path(rest[rest.index("--inbox") + 1])
    wf = Path(rest[rest.index("--workflow-dir") + 1])
    entity_ov = rest[rest.index("--entity") + 1] if "--entity" in rest else None
    auto = "--auto-record" in rest
    reader = rest[rest.index("--reader") + 1] if "--reader" in rest else "splash"
    url = (rest[rest.index("--reader-url") + 1] if "--reader-url" in rest
           else "http://127.0.0.1:8000")
    model = rest[rest.index("--reader-model") + 1] if "--reader-model" in rest else None
    state = Path(rest[rest.index("--since") + 1]) if "--since" in rest else None
    done = Path(rest[rest.index("--done") + 1]
                if "--done" in rest else inbox / "done")
    done.mkdir(exist_ok=True)
    seen = set(json.loads(state.read_text())) if state and state.exists() else set()

    pdfs = sorted(p for p in inbox.iterdir()
                  if p.is_file() and p.suffix == ".pdf"
                  and not p.name.startswith("."))
    fresh = [p for p in pdfs if p.name not in seen]
    if not fresh:
        print("loop: no new returns")
        return
    for pdf in fresh:
        entity = entity_for(pdf.name, entity_ov)
        marks = pdf_marks(pdf)
        if marks.strip():
            source = "pdf-text"
            text = marks
        else:
            source = f"{reader}-vlm"
            text = vlm_read(pdf, reader, url, model)
        decision, reason = parse_decision(text)
        evidence = marks.strip().splitlines()[0][:120] if marks.strip() else reason
        stamp = f"rm:{pdf.name}: {evidence}"[:220]
        cmd = ["spacedock", "gate", "record", entity,
               "--decision", decision, "--actor", "person:captain",
               "--reason", stamp]
        if decision == "approve":
            cmd.append("--consume")
        cmd += ["--workflow-dir", str(wf)]
        if decision == "unclear":
            print(f"{pdf.name}: unclear marks ({source}) — needs eyes, no record")
            print("  marks/text:\n  " + "\n  ".join(text.splitlines()[:12]))
            continue
        if auto and source == "pdf-text":
            out = run(cmd).stdout.strip().replace("\n", " | ")
            print(f"{pdf.name}: recorded {decision} ({source}) :: {out}")
            pdf.rename(done / pdf.name)
            seen.add(pdf.name)
        else:
            why = ("VLM reads need eyes; not auto-recorded"
                   if source != "pdf-text" else "draft:")
            print(f"{pdf.name}: {why} {decision} ({source}):")
            print("  " + shlex.join(cmd))
    if state:
        state.write_text(json.dumps(sorted(seen)))


if __name__ == "__main__":
    main()
