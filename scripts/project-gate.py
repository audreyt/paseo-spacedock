# Public domain under CC0 1.0. See LICENSE and PATENTS.md.
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

"""Project one open Spacedock gate to a bilingual Lantern spine.

Reads: entity front-matter gates binding + room index.json + stage def.
Emits: gate-spine.md (one en:/zh: pair per block) for lantern.py.
The Recommend line is FO judgment, not Briefing data: --recommend is required.
--gloss maps English source strings to zh renderings; unmapped source text is
tagged [runin: 原文:] in zh spans instead of leaking silently.
-o inside the workflow dir is refused: Spacedock would discover the spine
as a phantom entity.
Usage: project_gate.py <workflow-dir> <entity-slug> --recommend approve|reject
       [--reason TEXT] [-o spine.md] [--gloss gloss.json]
"""
import json
import re
import subprocess
import sys
from pathlib import Path


def read_frontmatter_briefing(entity_path):
    text = entity_path.read_text()
    m = re.search(r"^---\n(.*?)\n---\n", text, re.S)
    assert m, "no front-matter"
    fm = m.group(1)
    bid = re.search(r"^\s*id: (briefing:\S+)", fm, re.M)
    dig = re.search(r"^\s*digest: (\S+)", fm, re.M)
    room = re.search(r"^\s*room-ref: (\S+)", fm, re.M)
    title = re.search(r"^title: (.+)$", fm, re.M)
    status = re.search(r"^status: (\S+)", fm, re.M)
    assert bid and dig and room, "no open gate binding in front-matter"
    return {
        "briefing_id": bid.group(1),
        "digest": dig.group(1),
        "room_ref": room.group(1).lstrip("./"),
        "title": title.group(1).strip() if title else entity_path.stem,
        "status": status.group(1) if status else "?",
    }


def read_stage_def(workflow_dir, stage):
    out = subprocess.run(
        ["spacedock", "dispatch", "show-stage-def",
         "--workflow-dir", str(workflow_dir), "--stage", stage],
        capture_output=True, text=True, check=True,
    ).stdout
    gc = re.search(r"\*\*Gate content:\*\*\s*(.+)", out)
    return {
        "gate_content": gc.group(1).strip() if gc else "",
        "stage_def": out.strip(),
    }


def parse_args(argv):
    wf = Path(argv[1])
    slug = argv[2]
    rest = argv[3:]
    if "--recommend" not in rest:
        raise SystemExit("missing required --recommend approve|reject")
    rec = rest[rest.index("--recommend") + 1]
    assert rec in ("approve", "reject"), "--recommend must be approve|reject"
    reason = ""
    if "--reason" in rest:
        reason = rest[rest.index("--reason") + 1]
    if rec == "reject" and not reason:
        raise SystemExit("--recommend reject requires --reason TEXT")
    dest = Path("gate-spine.md")
    if "-o" in rest:
        dest = Path(rest[rest.index("-o") + 1])
    wf_res, dest_res = wf.resolve(), dest.resolve()
    if dest_res == wf_res or wf_res in dest_res.parents:
        raise SystemExit(f"refusing -o inside workflow dir ({dest}): "
                         f"Spacedock would discover it as a phantom entity")
    gloss = {}
    if "--gloss" in rest:
        gloss = json.loads(Path(rest[rest.index("--gloss") + 1]).read_text())
    return wf, slug, rec, reason, dest, gloss


def zh_src(s, gloss):
    """Render a data-derived source string for a zh span."""
    if s in gloss:
        return gloss[s]
    return f"[runin: 原文:] {s}"


def main():
    wf, slug, rec, reason, dest, gloss = parse_args(sys.argv)
    entity = wf / f"{slug}.md"
    bind = read_frontmatter_briefing(entity)
    room = wf / bind["room_ref"] / "index.json"
    if not room.exists():
        room = wf / bind["room_ref"] / "gate-briefing.json"
    briefing = json.loads(room.read_text())
    assert briefing["id"] == bind["briefing_id"], "binding/room id mismatch"
    stage = read_stage_def(wf, bind["status"])
    q = briefing["question"]
    arts = briefing.get("artifacts", [])
    digest_short = bind["digest"].split(":")[1][:12]

    if rec == "approve":
        rec_en = "**Recommend approve.**"
        rec_zh = "**建議批准。**"
    else:
        rec_en = f"**Recommend reject: {reason}.**"
        rec_zh = f"**建議退回：**{zh_src(reason, gloss)}"

    L = []
    L.append("---")
    L.append(f"title: Gate review · {bind['title']}")
    L.append(f"title_zh: 閘門覆核 · {bind['title']}")
    L.append("description: Projected Spacedock gate briefing for e-ink intake.")
    L.append("localStorageKey: lang-gate-projection-trial")
    L.append(f"eyebrow_en: Spacedock gate · {bind['status']}")
    L.append(f"eyebrow_zh: Spacedock 閘門 · {bind['status']}")
    L.append(f"subject_en: {bind['title']}")
    L.append(f"subject_zh: {bind['title']}")
    L.append("deck_en: One gate, one decision")
    L.append("deck_zh: 一個閘門，一個決定")
    L.append(f"standfirst_en: Projected from {bind['briefing_id']} ({bind['digest'][:19]}…).")
    L.append(f"standfirst_zh: 投影自 {bind['briefing_id']}（{bind['digest'][:19]}…）。")
    L.append("footer_en: gate projection trial")
    L.append("footer_zh: 閘門投影試驗")
    L.append("---")
    L.append("")
    L.append("<!-- sheet -->")
    L.append("")
    L.append("## [Gate review / 閘門覆核] The decision / 這個決定")
    L.append("")
    L.append(f"en: {rec_en} {q}")
    L.append(f"zh: {rec_zh}{zh_src(q, gloss)}")
    L.append("")
    L.append(f"en: Reviewed snapshot: {bind['briefing_id']} (sha256:{digest_short}…).")
    L.append(f"zh: 覆核快照：{bind['briefing_id']}（sha256:{digest_short}…）。")
    L.append("")
    if stage["gate_content"]:
        L.append(f"en: Gate content preference: {stage['gate_content']}")
        L.append(f"zh: 閘門內容偏好：{zh_src(stage['gate_content'], gloss)}")
        L.append("")
    L.append("<!-- sheet -->")
    L.append("")
    L.append("## [Evidence / 證據] What the briefing binds / 簡報綁定的內容")
    L.append("")
    for i, a in enumerate(arts, 1):
        L.append(f"en: **Artifact {i}.** {a.get('summary', '')} ({a.get('uri', '')}, rev {a.get('rev', '')[:19]}…).")
        L.append(f"zh: **產物 {i}。**{zh_src(a.get('summary', ''), gloss)}（{a.get('uri', '')}，版本 {a.get('rev', '')[:19]}…）。")
        L.append("")
    L.append("<!-- sheet -->")
    L.append("")
    L.append("## [Decision / 決定] Say yes or bounce back / 批准或退回")
    L.append("")
    L.append("en: Approve to ship this briefing; reject to bounce it back with findings.")
    L.append("zh: 批准即出貨此簡報；退回則附理由打回。")
    L.append("")
    dest.write_text("\n".join(L))
    print(f"wrote {dest} ({len(arts)} artifacts, digest {digest_short})")


if __name__ == "__main__":
    main()
