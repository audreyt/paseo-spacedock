# paseo-spacedock

Public domain under [CC0 1.0](LICENSE), plus the patent grant in [PATENTS.md](PATENTS.md).

A [Paseo](https://paseo.sh) plugin that puts [Spacedock](https://github.com/spacedock-dev/spacedock)'s
decision layer inside Paseo: agents do the work, the captain records the calls.

Requires the `spacedock` binary on the daemon host and a commissioned workflow
(a directory whose README frontmatter carries `commissioned-by: spacedock@…`).
If the workspace has none, the panel offers to **bootstrap** one: it infers a
mission and `docs/<slug>-workflow/` target from the repo's README/AGENTS.md,
scaffolds a validated refinement-shaped workflow, and can launch a Commission
agent to tailor it. The default location `docs/<slug>-workflow/` is a tracker,
distinct from the repo's own content dirs. A bare `<dir>/` line in the root
`.gitignore` hides the workflow from Spacedock discovery — bootstrap suggests
another location or rewrites the rule to `<dir>/*` with negations, and warns if
it can't.

## What it does

- **Workspace panel** — stage map (gate/worktree/terminal flags), dispatchable
  entities, and every gate awaiting the captain with Approve / Revise / Hold.
  Approvals use `gate record --consume`. Revise and Hold require a reason
  (the CLI rejects them without `--reason`), so those buttons stay disabled
  until one is typed; Approve's reason stays optional.
- **New Spacedock** — global Command Center item and sidebar surface. Pick a
  registered project; the plugin creates a workspace *without* a first agent
  (`firstAgentContext` omitted) and opens the Spacedock panel. Paseo's built-in
  New workspace form always starts Chat or a terminal — this skips that dummy
  session. Once inside a workspace, **Open Spacedock** / `/spacedock` still
  open the panel on the current workspace.
- **Workflow bootstrap** — when no commissioned workflow is found, the panel
  infers a mission and `docs/<slug>-workflow/` target from the repo's
  README/AGENTS.md, scaffolds a validated refinement-shaped workflow, and can
  launch a Commission agent to tailor it.
- **Timeline card** — when an agent's turn ends with gates pending, a
  `spacedock-gates` row is appended to its timeline; decisions can be recorded
  inline without opening the panel. The card revalidates against live
  `status --next` on mount; gates that already moved on render without buttons
  instead of failing on click.
- **Session env injection** — any agent session opened inside a workflow gets
  `SPACEDOCK_BIN`, `SPACEDOCK_WORKFLOW_DIR`, and `PASEO_SPACEDOCK_ROLE`
  (`first-officer` via the `spacedock.role` label, `ensign` for children).
- **Launch first officer** — creates a labeled first-officer agent in the
  workspace with the dispatcher system prompt, pointed at the detected
  workflow dir and the first-officer skill when resolvable. The provider is
  resolved as `provider/model`: an explicit `provider/model` setting wins; a
  bare provider picks your Paseo agent profile for it, else the provider's
  default model; empty picks the first available provider with a profile or
  default model.
- **`/spacedock`** slash command and a workspace Command Center item open the
  panel in an existing workspace.
- **Settings screen** — binary path override, skills directory, first-officer
  provider (empty = first available), TypeSafe API key, base URL, and judge model.

## Gate judgment (Jev / TypeSafe-compatible)

The **Judge** button on a gate asks a TypeSafe System One model (Jev by default)
for a recommendation and shows it next to the gate; the captain still records the
decision as `person:captain`. The model returns a typed judgment, not prose:

- **verdict** — a `choice` among `approve`, `revise`, `hold`, with a
  `confidence` number and a `probabilities` object over the three options.
- **evidence** — a `noul` probability (0–1) that the briefing artifacts actually
  support the gate question being answered.
- **risk** — a `score` (0–2) for how costly a wrong approval would be, from
  "routine and easily reversed" to "serious damage or hard to reverse".

The recommendation is advisory only. The plugin never records a decision on its
own — it shows a **policy outcome** (`delegate <verdict>` or
`advise <verdict> (<reason>)`) computed from the judgment. `delegate` is a
statement of what the policy would permit given the numbers, not an actuator:
no gate is recorded automatically. Approve / Revise / Hold still call
`gate record --consume` on approval and stamp the captain's reason with the
judgment's stamp (`jev:<verdict> conf=… evidence=… risk=…`). In the stamp and
in the policy, every number is a 0–1 fraction; risk is its 0–2 score divided by
two, so a raw `0.67` is stamped as `risk=0.33`.

### Settings and environment

The judge resolves its credentials and endpoint in this order:

- **API key** — `typesafeApiKey` in plugin settings, falling back to the
  `TYPESAFE_API_KEY` environment variable on the daemon. Optional; needed for
  `api.typesafe.ai`, but local TypeSafe-compatible servers usually need none.
- **Base URL** — `typesafeBaseUrl` in plugin settings, falling back to
  `TYPESAFE_BASE_URL` on the daemon, then `https://api.typesafe.ai`. Empty means
  the public endpoint.
- **Model** — `typesafeModel` in plugin settings, falling back to
  `TYPESAFE_DEFAULT_MODEL` on the daemon, then `jev-latest`.

Any server implementing `POST /v1/systemone` with the TypeSafe request/response
shape works as a base URL — point it at a local TypeSafe-compatible server if
you run one. For example, against a local server with no key:

```
TYPESAFE_BASE_URL=http://127.0.0.1:8001
TYPESAFE_DEFAULT_MODEL=<your model>
```

The daemon process must actually have those env vars — a daemon launched by
the desktop app does not read your shell rc, so either restart the daemon from
a shell that has them or set base URL/model in the plugin settings screen.

## Gate projection (scripts, e-ink intake)

`scripts/` carries a zero-dependency Python path from an open gate to a
captain-readable page, for surfaces outside the Paseo panel — e.g. an e-ink
tablet that syncs over Dropbox/Drive:

- `project-gate.py <workflow-dir> <entity> --recommend approve|reject
  [--reason TEXT] [--gloss gloss.json]` reads the entity's `gates:`
  front-matter binding, the room's canonical Briefing (`index.json`), and the
  stage's `Gate content` preference, and emits a bilingual
  `en:`/`zh:` spine. The Recommend line is first-officer judgment, never
  Briefing data, so `--recommend` is required; `--recommend reject` also
  requires `--reason`. `--gloss` maps English source strings to zh
  renderings; unmapped source text is tagged `[runin: 原文:]` in zh spans.
  `-o` inside the workflow dir is refused (phantom-entity guard).
- `remarkable-intake.py ... --outbox DIR --lantern PATH [--print-lang
  both|en|zh]` runs the projector, renders HTML with the given
  Lantern-compatible renderer, prints a Move-portrait PDF with headless
  Chrome (virtual-time budget so webfonts embed; CJK prints in the
  renderer's declared print face), and drops it in `--outbox`.
  `remarkable-intake.py inbox --dir DIR [--since STATE]` reports newly
  returned files with the matching `gate record` template.
- `gate-loop.py --inbox DIR --workflow-dir DIR [--auto-record]` closes the
  loop: for each new annotated PDF it reads the captain's marks — typed
  PDF annotations via pypdf, else a rendered page through a vision reader
  (default `--reader splash`: OpenAI-compatible `image_url` turns against
  `--reader-url`, model auto-discovered from `/v1/models`;
  `--reader ollama --reader-model <vision-capable>` is the fallback) —
  parses one unambiguous decision, and drafts `gate record --actor
  person:captain` (`--consume` on approve; present-gate "reject" maps to
  record "revise"; the reason stamps the source file plus the transcribed
  mark). Only typed annotations auto-record: they are captain-added bytes
  by construction. VLM reads always draft for human confirmation, because
  a rasterized page cannot distinguish printed prompt text from handwritten
  marks. Conflicting or missing marks stay human-read, never auto-recorded.
  Processed files move to `done/`, so re-polls are idempotent. Printed
  page text is outbound content and is never parsed as a decision.

## Install

```bash
paseo plugin install /absolute/path/to/paseo-spacedock
```

Requires Paseo ≥ 0.8.0 with `pluginsEnabled: true` in the daemon's
`config.json`. For a remote daemon:

```bash
paseo --host ssh://user@host plugin install /path/on/that/host/paseo-spacedock
```

## Develop

```bash
pnpm install       # devDependencies are for typechecking only
pnpm typecheck
paseo plugin reload paseo-spacedock
paseo plugin logs paseo-spacedock
```

Layout: `index.server.ts` + `server/` run in a daemon subprocess and shell out
to the `spacedock` CLI; `index.client.tsx` + `client/` render in the app;
`shared/` holds the Zod RPC contracts and settings schema.

## Development: the policy core is Bend2

The deterministic gate policy — whether a Jev judgment may be delegated or must
only advise, and why — is written in [Bend2](https://bend-lang.com) and
compiled to JavaScript. Users need nothing: `server/gate/gate.generated.js` is
committed and loaded at runtime. Only developers editing the policy need the
`bend` toolchain.

What lives in `bend/`:

- `gate.bend` — the policy code: types (`Verdict`, `Judgment`, `Policy`,
  `Decision`, `Reason`), `Gate.decide`, display/stamp functions.
- `LAWS.bend` — the spec: laws the policy must satisfy.
- `PROOF.bend` — proofs that discharge every law in `LAWS.bend`.
- `entry.bend` — export manifest; the JS emitter keeps only what `main` reaches,
  so this touches every def the host calls.

After editing any `.bend` file, regenerate the JS:

```bash
pnpm bend:build
```

The build refuses to emit unless `bend bend/PROOF.bend` prints
`All terms check.` — the laws are checked first, so a broken policy never
reaches the committed JS. For CI drift detection:

```bash
pnpm bend:check
```

Install Bend (dev only):

```bash
curl -fsSL https://bend-lang.com/install.sh | sh
```

The 12 laws (from `LAWS.bend`):

- **verdict_preserved** — the decision always carries the judgment's own
  verdict; the policy never substitutes a different one.
- **never_delegate_stale** — stale evidence is never delegated, whatever the
  numbers say.
- **never_delegate_low_confidence** — below the confidence floor, never
  delegated.
- **never_delegate_without_evidence** — without an evidence measurement, never
  delegated.
- **never_delegate_without_risk** — without a risk measurement, never
  delegated.
- **step_blocks_low_confidence** — a failing confidence check blocks
  delegation regardless of later checks.
- **step_blocks_weak_evidence** — weak evidence blocks delegation.
- **step_blocks_high_risk** — high risk blocks delegation.
- **step_blocks_ambiguous** — a failing margin check blocks delegation.
- **step_delegates_iff_all_pass** — delegation happens exactly when every
  check passed (no other path in).
- **can_delegate** — the policy is not vacuous: some fresh, well-supported
  judgment is delegated.
- **verdict_roundtrip** — verdict names round-trip through the wire format.

## License

This project is dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`). The legal text is [LICENSE](LICENSE), copied verbatim. The same text is in [LICENSES/CC0-1.0.txt](LICENSES/CC0-1.0.txt) for license scanners. This section explains the dedication. It does not change the legal text.

The dedication covers the files in this repository: source, docs, scripts, proofs, and generated code.

You may copy, change, and share this project for any purpose, including commercial use. Giving credit is optional. Publishing your changes is optional. Asking permission is unnecessary. There is no warranty, and there is no endorsement of anyone who uses the project.

Where the law allows it, copyright and related rights in these files, including database rights, are waived worldwide for the longest term the law provides. Where a court will not give that waiver effect, the backup license inside CC0 gives each person those same rights.

Patent rights are granted in [PATENTS.md](PATENTS.md). That grant is permanent, worldwide, royalty-free, and irrevocable. It covers patent claims the rights holder can license when this project infringes them. Trademarks and names stay with their owners. Patents that belong to other people stay with those people.

Work from other people stays under its own terms. Packages installed from a registry are not part of this dedication.

Copies of this repository already received under the Apache License 2.0 stay under that license. This dedication applies to the project as published with this LICENSE file.

No person is named in the license. Keep personal data out of the tree. Contribution terms are in [CONTRIBUTING.md](CONTRIBUTING.md).
