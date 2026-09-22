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
3. Classify the marks with a typed judgment: Splash `/v1/systemone`
   `choice` over approve|revise|hold|none, read from answer-slot logits
   with thinking disabled (fast, and it reports calibrated probabilities).
   `none`, or confidence below --min-confidence, abstains. `--no-judge`
   (or an unreachable endpoint) falls back to strict keyword matching,
   which carries no confidence and therefore never auto-records.
4. With --auto-record, execute `gate record --actor person:captain`
   (--consume on approve) — annotation reads judged above the floor only.
   VLM reads always draft for human confirmation, because a rasterized
   page cannot distinguish printed prompt text from handwritten marks.
5. Move processed files to DONE so the loop is idempotent.

Present-gate "reject" maps to record "revise" (bounce back with findings).

Usage:
  gate-loop.py --inbox DIR --workflow-dir DIR [--entity SLUG]
      [--auto-record] [--min-confidence 0.85] [--no-judge]
      [--reader splash|ollama] [--reader-url URL] [--reader-model MODEL]
      [--since STATE] [--done DIR]
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


DECISION_QUESTION = {
    "type": "choice",
    "instructions": "The captain wrote these marks on a gate-review page. "
                    "Which decision do the marks express?",
    "criteria": {
        "approve": "The marks approve, accept, or say yes (批准／同意／准／ok／lgtm).",
        "revise": "The marks reject, bounce back, or ask for changes "
                  "(退回／修改／打回).",
        "hold": "The marks defer or wait (待定／稍等／hold).",
        "none": "The marks express no decision at all.",
    },
}


def judge_decision(text, url, model, floor):
    """Typed judgment over the marks: /v1/systemone choice with a confidence
    floor. Returns (decision, reason, detail) or None when the endpoint is
    unavailable, so the caller can fall back to keyword matching."""
    try:
        d = _post_json(url + "/v1/systemone", {
            "model": model or splash_first_model(url),
            "state": text.strip() or "(no marks)",
            "questions": {"decision": DECISION_QUESTION},
        }, timeout=120)
    except Exception as error:
        print(f"  (typed judgment unavailable: {type(error).__name__}; "
              f"falling back to keywords)")
        return None
    a = d["answers"]["decision"]
    choice, conf = a["choice"], a["confidence"]
    detail = (f"judged {choice} conf={conf:.2f} "
              f"p={{{', '.join(f'{k}={v:.2f}' for k, v in a['probabilities'].items())}}}")
    if choice == "none" or conf < floor:
        return "unclear", "-", detail
    return choice, f"judged {choice} conf={conf:.2f}", detail


def parse_decision(text):
    """Deterministic fallback: strict DECISION: line, else a single
    unambiguous keyword family."""
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
    floor = float(rest[rest.index("--min-confidence") + 1]
                  if "--min-confidence" in rest else 0.85)
    keywords_only = "--no-judge" in rest
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
        judged = None if keywords_only else judge_decision(text, url, model, floor)
        if judged:
            decision, reason, detail = judged
        else:
            decision, reason = parse_decision(text)
            detail = f"keywords -> {decision}"
        evidence = marks.strip().splitlines()[0][:120] if marks.strip() else reason
        stamp = f"rm:{pdf.name}: {evidence}"[:220]
        cmd = ["spacedock", "gate", "record", entity,
               "--decision", decision, "--actor", "person:captain",
               "--reason", stamp]
        if decision == "approve":
            cmd.append("--consume")
        cmd += ["--workflow-dir", str(wf)]
        if decision == "unclear":
            print(f"{pdf.name}: unclear marks ({source}; {detail}) — "
                  f"needs eyes, no record")
            print("  marks/text:\n  " + "\n  ".join(text.splitlines()[:12]))
            continue
        if auto and source == "pdf-text" and judged:
            out = run(cmd).stdout.strip().replace("\n", " | ")
            print(f"{pdf.name}: recorded {decision} ({source}; {detail}) :: {out}")
            pdf.rename(done / pdf.name)
            seen.add(pdf.name)
        else:
            if source != "pdf-text":
                why = "VLM reads need eyes; not auto-recorded"
            elif not judged:
                why = "keyword read carries no confidence; not auto-recorded"
            else:
                why = "draft:"
            print(f"{pdf.name}: {why} {decision} ({source}; {detail}):")
            print("  " + shlex.join(cmd))
    if state:
        state.write_text(json.dumps(sorted(seen)))


if __name__ == "__main__":
    main()
