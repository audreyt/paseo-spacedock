// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { WorkflowSuggestion } from "../shared/contracts";
import { forgetDiscovery, resolveBin, spacedockVersion } from "./cli";
import { resolveSkillPath } from "./launch";
import { resolveAgentSelection } from "./provider";

const STOP_WORDS = new Set([
  "workspace",
  "repo",
  "repository",
  "project",
  "the",
  "a",
  "an",
]);

function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/_([^_]*)_/g, "$1")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace === -1) return `${slice}…`;
  return `${text.slice(0, lastSpace).trim()}…`;
}

function isNonParagraphLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^[-*+]\s/.test(trimmed)) return true;
  if (/^\d+\.\s/.test(trimmed)) return true;
  if (/^\|/.test(trimmed)) return true;
  if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^<!--/.test(trimmed) || /-->/.test(trimmed)) return true;
  if (/^@/.test(trimmed)) return true;
  return false;
}

function readSourceDoc(cwd: string): string | null {
  for (const name of ["README.md", "AGENTS.md", "CLAUDE.md"]) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        // try next
      }
    }
  }
  return null;
}

function parseTitle(doc: string): string | null {
  for (const line of doc.split("\n")) {
    const match = line.match(/^#\s+(.*)$/);
    if (match) {
      return stripInline(match[1].replace(/\s*#+\s*$/, "")).trim();
    }
  }
  return null;
}

function parseDescription(doc: string): string | null {
  const lines = doc.split("\n");
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return null;
  const paragraphLines: string[] = [];
  let inParagraph = false;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      if (inParagraph) break;
      continue;
    }
    if (isNonParagraphLine(line)) {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    paragraphLines.push(trimmed);
  }
  if (paragraphLines.length === 0) return null;
  const text = stripInline(paragraphLines.join(" ")).replace(/\s+/g, " ").trim();
  return truncate(text, 300);
}

function deriveSlug(title: string): string {
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .slice(0, 4);
  const slug = words.join("-").replace(/-{2,}/g, "-");
  return slug || "workflow";
}

function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["-C", cwd, "rev-parse", "--git-dir"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const root = out.trim();
    return root || cwd;
  } catch {
    return cwd;
  }
}

export interface Hidden {
  kind: "spacedock-prune" | "git-ignored";
  pattern: string;
  source?: string;
  line?: number;
}

// Spacedock discovery prunes any directory whose BASENAME appears in the repo
// root .gitignore as a line ending in `/` (comments and `!` lines skipped; only
// the basename of the pattern matters). Lines not ending in `/` do not prune.
function gitignorePrunedBasenames(root: string): Map<string, { pattern: string; line: number }> {
  const map = new Map<string, { pattern: string; line: number }>();
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return map;
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return map;
  }
  content.split("\n").forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) return;
    if (!line.endsWith("/")) return;
    // basename of the pattern (strip leading /, **/, trailing /)
    const stripped = line.replace(/^\//, "").replace(/^\*\*\//, "").replace(/\/$/, "");
    const seg = stripped.split("/").at(-1);
    if (seg && !map.has(seg)) {
      map.set(seg, { pattern: rawLine, line: idx + 1 });
    }
  });
  return map;
}

export function workflowDirHidden(cwd: string, dir: string): Hidden | null {
  const root = gitRoot(cwd);
  // Canonicalize cwd so the relative path matches git's canonical root (macOS
  // /var → /private/var symlink would otherwise break the segment walk).
  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = cwd;
  }
  const rel = relative(root, resolve(realCwd, dir));
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  // Spacedock-prune check: any path segment of dir (relative to gitRoot) in the
  // pruned-basename set.
  const pruned = gitignorePrunedBasenames(root);
  for (const seg of rel.split("/")) {
    if (!seg) continue;
    const hit = pruned.get(seg);
    if (hit) {
      return {
        kind: "spacedock-prune",
        pattern: hit.pattern,
        source: ".gitignore",
        line: hit.line,
      };
    }
  }
  // git check-ignore check
  try {
    const target = join(resolve(realCwd, dir), "README.md");
    const out = execFileSync(
      "git",
      ["-C", cwd, "check-ignore", "-v", "--no-index", "--", target],
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    );
    // format: <source>:<line>:<pattern>\t<path>
    const m = out.match(/^([^:]+):(\d+):([^\t]+)\t/);
    if (m) {
      const pattern = m[3].trim();
      // A `!` negation pattern means the path is NOT ignored; check-ignore -v
      // still prints it (and exits 0) when it is the last matching pattern.
      if (pattern.startsWith("!")) return null;
      return {
        kind: "git-ignored",
        pattern,
        source: m[1],
        line: Number(m[2]),
      };
    }
  } catch {
    // exit non-zero = not ignored → null
  }
  return null;
}

function ensureGitRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  }
}

function ensureGitignoreEntry(cwd: string): boolean {
  const gitignorePath = join(cwd, ".gitignore");
  const entry = ".worktrees/";
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf8");
    if (content.split("\n").includes(entry)) return false;
    appendFileSync(gitignorePath, `${content.endsWith("\n") ? "" : "\n"}${entry}\n`);
    return true;
  }
  writeFileSync(gitignorePath, `${entry}\n`);
  return true;
}

function runSync(
  bin: string,
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(bin, args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout: String(stdout), stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

function buildWorkflowReadme(params: {
  version: string;
  entityType: string;
  entityLabelField: string;
  entityLabelPlural: string;
  dir: string;
  missionTitle: string;
  missionDescription: string;
  date: string;
  lower: string;
  capital: string;
  lowerPlural: string;
}): string {
  const {
    version,
    entityType,
    entityLabelField,
    entityLabelPlural,
    dir,
    missionTitle,
    missionDescription,
    date,
    lower,
    capital,
    lowerPlural,
  } = params;
  const descriptionBlock = missionDescription
    ? `\n${missionDescription}\n`
    : "\n";
  return `---
commissioned-by: spacedock@${version}
entity-type: ${entityType}
entity-label: ${entityLabelField}
entity-label-plural: ${entityLabelPlural}
id-style: slug
state: $inline
stages:
  defaults:
    worktree: false
    concurrency: 2
  states:
    - name: draft
      initial: true
    - name: review
      gate: true
      feedback-to: draft
      context-sections:
        - Standing checks
    - name: polish
    - name: done
      terminal: true
---

# ${missionTitle}
${descriptionBlock}
This workflow was bootstrapped from Paseo on ${date} with the refinement shape (draft → review → polish → done). Tailor the stage prose and the entity template to this repository; \`spacedock status --validate --workflow-dir ${dir}\` checks the frontmatter.

## File Naming

Each ${lower} lives as either:

- a flat markdown file \`{slug}.md\` (default — use this unless the ${lower} produces many side files), or
- a folder \`{slug}/\` containing \`index.md\` as the canonical entity file, when the ${lower} produces per-stage attachments (drafts, reviewer notes, transcripts, output files) that belong alongside the tracker.

Slugs are lowercase, hyphens, no spaces. Example: \`q3-launch-narrative.md\` or \`q3-launch-narrative/index.md\`.

## Schema

Every ${lower} file has YAML frontmatter. Fields are documented below; see **${capital} Template** for a copy-paste starter.

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| \`id\` | string | Unique identifier, format determined by id-style in README frontmatter |
| \`title\` | string | Human-readable ${lower} name |
| \`status\` | enum | One of: draft, review, polish, done |
| \`source\` | string | Where this ${lower} came from |
| \`started\` | ISO 8601 | When active work began |
| \`completed\` | ISO 8601 | When the ${lower} reached terminal status |
| \`verdict\` | enum | PASSED or REJECTED — set at final stage |
| \`score\` | number | Priority score, 0.0–1.0 (optional) |
| \`worktree\` | string | Worktree path while a dispatched agent is active, empty otherwise. Once set on first dispatch into a \`worktree: true\` stage, it stays set across all non-terminal advancements (stickiness) and clears at terminal merge. |
| \`issue\` | string | GitHub issue reference (optional cross-reference) |
| \`pr\` | string | GitHub PR reference (set when a PR is created) |

## Stages

### \`draft\`

The ${lower} is produced or revised — every time it enters the loop, including after a review bounce. The draft integrates prior reviewer notes and is complete enough to be evaluated end-to-end.

- **Inputs:** The ${lower} body and any prior review notes.
- **Outputs:** A complete draft ready to be evaluated end-to-end.

### \`review\`

A reviewer reads the whole draft and makes a clear accept/reject decision behind an approval gate: gate-approval to \`polish\`, or rejection back to \`draft\` with specific, actionable notes.

- **Gate content:** Show the review decision, non-empty actionable findings, and whether approval advances to polish or rejection returns to draft.
- **Inputs:** The complete draft and the gate question.
- **Outputs:** An accept/reject decision with specific, actionable notes.

### \`polish\`

Final cleanup before the ${lower} is locked and shipped (or filed, per the variant). Cosmetic only; preserves the substance the reviewer accepted and reopens nothing structural.

- **Inputs:** The accepted draft from review.
- **Outputs:** A cleaned-up version with cosmetic fixes only.

### \`done\`

Terminal state: the ${lower} is locked and shipped (or filed, per the variant). \`completed\` set, \`verdict: PASSED\`, archived. Start a new entity rather than reopening a done one.

- **Inputs:** The polished ${lower}.
- **Outputs:** A locked, shipped ${lower} with \`completed\` set and \`verdict: PASSED\`.

## Workflow-specific rules

The FO/ensign operating contract already governs generic stage semantics and proof discipline. Refinement is the universal base shape, so most of its discipline lives in the contract; the rules below add only the refinement-shape specifics.

- **Human-in-the-loop quality bar.** \`review\` is an approval gate a human reviewer owns — the reviewer reads the whole draft and makes an explicit accept/reject call with concrete notes, never a vague "this needs work." \`polish\` is cosmetic-only; new content that should have gone through review does not belong there.
- **No layers by default.** The base shape touches no repo and waits on no external event, so no structural layers fire. Variants that need them (e.g. outreach's \`watching\` stage) activate the layer through the variant, not the base.
- **Variant menu.** Common end-use shapes are refinement with adjusted stages and a different entity body — \`outreach\`, \`integration\`, \`content-production\`, \`prd-authoring\` (see \`## Adoption\` → Surface variants). A variant changes the stage list and snippet, never the underlying draft → review → ship structure.

## Standing checks

The \`review\` stage loads these via \`context-sections: [Standing checks]\` so dispatch carries them with the gate. A fail on any one is needs-attention.

- Replace with the checks every gate applies; a fail on any one is needs-attention.

## Workflow State

View the workflow overview:

\`\`\`bash
spacedock status --workflow-dir ${dir}
\`\`\`

Output columns: ID, SLUG, STATUS, TITLE, SCORE, SOURCE.

Find dispatchable ${lowerPlural} ready for their next stage:

\`\`\`bash
spacedock status --workflow-dir ${dir} --next
\`\`\`

## ${capital} Template

\`\`\`yaml
---
id:
title: ${capital} name here
status: draft
source:
started:
completed:
verdict:
score:
worktree:
issue:
pr:
---

Brief description of this ${lower} and what it aims to achieve.

## Draft

The current draft of the ${lower} lives here.

## Review notes

Reviewer notes accumulated across review rounds.

## Final

The locked, polished version (filled in at polish or done).
\`\`\`

## Commit Discipline

- Commit status changes at dispatch and merge boundaries
- Commit ${lower} body updates when substantive
`;
}

export function inferSuggestion(
  cwd: string,
  opts: { bin?: string; skillsDir?: string } = {},
): WorkflowSuggestion {
  const doc = readSourceDoc(cwd);
  const title = doc ? parseTitle(doc) : null;
  const description = doc ? parseDescription(doc) : null;
  let mission: string;
  if (title && description) {
    mission = `${title}: ${description}`;
  } else if (title) {
    mission = title;
  } else if (description) {
    mission = description;
  } else {
    mission = `Track work in ${basename(cwd)} through review`;
  }
  const slug = title ? deriveSlug(title) : "workflow";
  // Candidate locations, in preference order. The `-workflow` suffix marks the
  // directory as a tracker, distinct from the repo's own content dirs.
  const candidates: string[] = [
    `docs/${slug}-workflow`,
    `workflows/${slug}`,
    `${slug}-workflow`,
  ];
  // Append -2, -3 on collision for the preferred docs/ candidate.
  if (existsSync(join(cwd, candidates[0], "README.md"))) {
    for (let n = 2; n <= 9; n++) {
      const alt = `docs/${slug}-workflow-${n}`;
      if (!existsSync(join(cwd, alt, "README.md"))) {
        candidates[0] = alt;
        break;
      }
    }
  }
  let dir = candidates[0];
  let hidden: Hidden | null = null;
  let note: string | undefined;
  for (const candidate of candidates) {
    const h = workflowDirHidden(cwd, candidate);
    if (!h) {
      dir = candidate;
      break;
    }
    if (!hidden) hidden = h;
  }
  if (dir === candidates[0]) {
    // preferred candidate was chosen; no note needed
  } else if (hidden) {
    note = `docs/ is git-ignored (\`${hidden.pattern}\` in .gitignore) and Spacedock discovery prunes it; suggesting ${dir} instead. Bootstrap can also fix the .gitignore rule if you keep a docs/ path.`;
  }
  const skillFound = resolveSkillPath("commission", opts.skillsDir) !== null;
  return {
    dir,
    mission,
    entityLabel: "task",
    gitRepo: isGitRepo(cwd),
    skillFound,
    hidden: hidden ?? null,
    note,
  };
}

export async function scaffoldWorkflow(input: {
  cwd: string;
  dir: string;
  mission: string;
  entityLabel?: string;
  bin?: string;
}): Promise<
  | {
      ok: true;
      workflowDir: string;
      created: string[];
      notes: string[];
      warning?: string;
    }
  | { ok: false; error: string }
> {
  const { cwd, dir, mission, bin } = input;
  const target = resolve(cwd, dir);
  const rel = relative(cwd, target);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
    return {
      ok: false,
      error: `target directory ${dir} is not strictly inside ${cwd}`,
    };
  }
  if (existsSync(join(target, "README.md"))) {
    return {
      ok: false,
      error: `README.md already exists at ${dir}; a workflow README needs a \`commissioned-by: spacedock@…\` frontmatter line`,
    };
  }
  ensureGitRepo(cwd);
  const version = (await spacedockVersion(bin)) ?? "paseo";
  const labelRaw = (input.entityLabel ?? "task").trim().toLowerCase() || "task";
  const entityType = labelRaw.replace(/ /g, "_");
  const entityLabelField = labelRaw.split(/\s+/).at(-1) ?? labelRaw;
  const entityLabelPlural = `${labelRaw}s`;
  const lower = labelRaw;
  const capital = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);
  const lowerPlural = entityLabelPlural;
  const colonIdx = mission.indexOf(": ");
  const missionTitle = colonIdx >= 0 ? mission.slice(0, colonIdx) : mission;
  const missionDescription = colonIdx >= 0 ? mission.slice(colonIdx + 2) : "";
  const date = new Date().toISOString().slice(0, 10);
  const readme = buildWorkflowReadme({
    version,
    entityType,
    entityLabelField,
    entityLabelPlural,
    dir,
    missionTitle,
    missionDescription,
    date,
    lower,
    capital,
    lowerPlural,
  });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "README.md"), readme);
  const created: string[] = [`${dir}/README.md`];
  if (ensureGitignoreEntry(cwd)) {
    created.push(".gitignore");
  }

  const notes: string[] = [];
  let warning: string | undefined;

  // Visibility: a bare <seg>/ rule in the root .gitignore prunes Spacedock
  // discovery and hides the tree from git. If the first segment of dir matches
  // one of the simple forms, rewrite that exact line to <seg>/* and append
  // negations for the workflow dir.
  const hidden = workflowDirHidden(cwd, dir);
  if (hidden) {
    const firstSeg = dir.split("/")[0];
    const root = gitRoot(cwd);
    const rootGitignore = join(root, ".gitignore");
    const bareForms = [`${firstSeg}/`, `/${firstSeg}/`];
    const starForms = [`${firstSeg}/*`, `/${firstSeg}/*`];
    // workflowDirHidden reports source ".gitignore" only for the root .gitignore
    // (gitignorePrunedBasenames reads the root); a nested .gitignore surfaces as
    // a git-ignored kind instead.
    const isRootGitignore = hidden.source === ".gitignore" && existsSync(rootGitignore);
    if (isRootGitignore && bareForms.includes(hidden.pattern)) {
      const finalPattern = `${hidden.pattern.replace(/\/$/, "")}/*`;
      // Rewrite the exact line in the root .gitignore
      const content = readFileSync(rootGitignore, "utf8");
      const lines = content.split("\n");
      const lineIdx = (hidden.line ?? 0) - 1;
      if (lineIdx >= 0 && lineIdx < lines.length && lines[lineIdx] === hidden.pattern) {
        lines[lineIdx] = finalPattern;
        const block = [
          "",
          "# Spacedock: keep the workflow tracker visible. A bare `<seg>/` rule prunes",
          "# discovery and hides the tree from git; `<seg>/*` plus these negations does not.",
          `!${dir}/`,
          `!${dir}/**`,
        ].join("\n");
        const text = lines.join("\n");
        if (!text.includes(`!${dir}/`)) {
          writeFileSync(
            rootGitignore,
            `${text}${text.endsWith("\n") ? "" : "\n"}${block}\n`,
          );
        } else {
          writeFileSync(rootGitignore, `${text}\n`);
        }
        notes.push(`rewrote .gitignore rule ${hidden.pattern} → ${finalPattern} and un-ignored ${dir}`);
      }
    } else if (isRootGitignore && starForms.includes(hidden.pattern)) {
      // Already <seg>/* form: just append negations if missing
      const content = readFileSync(rootGitignore, "utf8");
      if (!content.includes(`!${dir}/`)) {
        const block = [
          "",
          "# Spacedock: keep the workflow tracker visible. A bare `<seg>/` rule prunes",
          "# discovery and hides the tree from git; `<seg>/*` plus these negations does not.",
          `!${dir}/`,
          `!${dir}/**`,
        ].join("\n");
        writeFileSync(
          rootGitignore,
          `${content}${content.endsWith("\n") ? "" : "\n"}${block}\n`,
        );
        notes.push(`un-ignored ${dir} in .gitignore (parent rule ${hidden.pattern} kept)`);
      }
    }
    // Re-check after the fix
    const stillHidden = workflowDirHidden(cwd, dir);
    if (stillHidden) {
      warning = `${dir} is hidden from Spacedock discovery by ${stillHidden.pattern} (${stillHidden.source}:${stillHidden.line ?? "?"}); un-ignore it or choose another directory`;
    }
  }

  // Confirm discovery can see the workflow dir
  const discover = runSync(resolveBin(bin), ["status", "--discover"], cwd);
  if (discover.code === 0) {
    const realTarget = realpathSync(target);
    if (!discover.stdout.includes(realTarget)) {
      const msg = `${dir} is not visible to \`spacedock status --discover\` (likely git-ignored); un-ignore it or choose another directory`;
      warning = warning ? `${warning} · ${msg}` : msg;
    }
  }

  const validate = runSync(resolveBin(bin), [
    "status",
    "--validate",
    "--workflow-dir",
    target,
  ], cwd);
  if (validate.code !== 0) {
    return {
      ok: false,
      error: `scaffold written but validation failed: ${validate.stderr.trim() || validate.stdout.trim()}`,
    };
  }
  forgetDiscovery(cwd);
  return {
    ok: true,
    workflowDir: realpathSync(target),
    created,
    notes,
    warning,
  };
}

export async function launchCommissionAgent(
  input: {
    workspaceId: string;
    cwd: string;
    workflowDir: string;
    mission: string;
    provider?: string;
    bin?: string;
    skillsDir?: string;
  },
  { paseo }: PluginHandlerContext,
): Promise<{ agentId: string } | { error: string }> {
  const bin = resolveBin(input.bin);
  const skillPath = resolveSkillPath("commission", input.skillsDir);
  const root = gitRoot(input.cwd);
  const lines = [
    `You are commissioning a Spacedock workflow for the repository at ${input.cwd}.`,
    `A minimal, valid workflow was just scaffolded at ${input.workflowDir}: README.md with \`commissioned-by: spacedock@…\` frontmatter and refinement-shaped stages (draft → review (gate) → polish → done). Your job is to tailor it to this repository so the first officer can run it well.`,
    `Mission as scaffolded: ${input.mission}`,
    `Rules:`,
    `- Read ${input.workflowDir}/README.md first, then the repo's README.md / AGENTS.md / CLAUDE.md and the top-level layout, to learn what work items this repo actually processes.`,
    `- Rewrite the README's mission paragraph, entity naming (entity-type / entity-label / entity-label-plural), stage names, per-stage Inputs / Outputs / Good / Bad bullets, and the entity template so they are specific to this repo. Stage names are kebab-case; keep exactly one \`initial: true\` and one \`terminal: true\`; keep at least one \`gate: true\` stage with a \`feedback-to:\`; add \`worktree: true\` only to stages that modify the repo.`,
    `- Never remove or alter the \`commissioned-by:\` line. Keep \`state: $inline\` unless this is a code repo shipped through PRs, in which case follow the split-root journey in the commission skill.`,
    `- Do not create entities unless the repo already has obvious work items; then seed at most 3 with \`\${SPACEDOCK_BIN:-spacedock} new <slug> --workflow-dir ${input.workflowDir} < stub\`.`,
    `- Finish with \`\${SPACEDOCK_BIN:-spacedock} status --validate --workflow-dir ${input.workflowDir}\` and \`\${SPACEDOCK_BIN:-spacedock} status --boot --json --identify\`; both must succeed. Do not commit; leave the changes for the captain to review. Report what you changed in five lines or fewer.`,
    `- This repository is already versioned at ${root}. Never run \`git init\` inside a subdirectory; commit from the root.`,
    `- If the repo already organises its work items as directories or files, make each entity a tracker that points at them: the entity slug is the existing item's directory or file name, canonical files stay where they are, and the workflow directory holds only Spacedock state, gate notes and pointers. Say so in the README and never copy artifacts into the workflow directory.`,
    `- If the repo's AGENTS.md or README defines standing review criteria, put them under a dedicated \`## <Heading>\` section in the workflow README and reference it from the gate stage with \`context-sections: [<Heading>]\` so dispatch loads them with the stage.`,
    `- Keep the workflow directory visible: the root .gitignore must not contain a bare \`<dir>/\` rule for any segment of its path (Spacedock discovery prunes those basenames); use \`<dir>/*\` plus \`!\` negations if the parent must stay ignored.`,
  ];
  if (skillPath) {
    lines.push(
      `The commission skill is at ${skillPath}; follow its Batch Mode with mission = the mission above, location = ${input.workflowDir}, entity type from your reading of the repo, and treat the scaffolded README as the draft you overwrite. Skip the pilot run.`,
    );
  }
  const sel = await resolveAgentSelection(paseo, input.provider);
  if (!sel.ok) {
    return { error: sel.error };
  }
  const config: {
    provider: string;
    modeId?: string;
    thinkingOptionId?: string;
    systemPrompt: string;
  } = { provider: sel.provider, systemPrompt: lines.join("\n") };
  if (sel.modeId) config.modeId = sel.modeId;
  if (sel.thinkingOptionId) config.thinkingOptionId = sel.thinkingOptionId;
  const prompt = `Tailor the scaffolded Spacedock workflow at ${input.workflowDir} to this repository, then validate it.`;
  try {
    const agent = await paseo.workspaces.ref(input.workspaceId).agents.create({
      config,
      title: "Commission",
      prompt,
      env: {
        SPACEDOCK_BIN: bin,
        SPACEDOCK_WORKFLOW_DIR: input.workflowDir,
        PASEO_SPACEDOCK_ROLE: "commission",
      },
      labels: { "spacedock.role": "commission" },
    });
    return { agentId: agent.id };
  } catch (error) {
    return { error: String(error) };
  }
}
