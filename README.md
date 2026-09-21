# paseo-spacedock

A [Paseo](https://paseo.sh) plugin that puts [Spacedock](https://github.com/spacedock-dev/spacedock)'s
decision layer inside Paseo: agents do the work, the captain records the calls.

Requires the `spacedock` binary on the daemon host and a commissioned workflow
(a directory whose README frontmatter carries `commissioned-by: spacedock@…`).

## What it does

- **Workspace panel** — stage map (gate/worktree/terminal flags), dispatchable
  entities, and every gate awaiting the captain with Approve / Revise / Hold
  plus an optional recorded reason. Approvals use `gate record --consume`.
- **Timeline card** — when an agent's turn ends with gates pending, a
  `spacedock-gates` row is appended to its timeline; decisions can be recorded
  inline without opening the panel.
- **Session env injection** — any agent session opened inside a workflow gets
  `SPACEDOCK_BIN`, `SPACEDOCK_WORKFLOW_DIR`, and `PASEO_SPACEDOCK_ROLE`
  (`first-officer` via the `spacedock.role` label, `ensign` for children).
- **Launch first officer** — creates a labeled first-officer agent in the
  workspace with the dispatcher system prompt, pointed at the detected
  workflow dir and the first-officer skill when resolvable.
- **`/spacedock`** slash command and a Command Center item open the panel.
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

The recommendation is advisory only. Approve / Revise / Hold still call
`gate record --consume` on approval and stamp the captain's reason.

### Settings and environment

The judge resolves its credentials and endpoint in this order:

- **API key** — `typesafeApiKey` in plugin settings, falling back to the
  `TYPESAFE_API_KEY` environment variable on the daemon.
- **Base URL** — `typesafeBaseUrl` in plugin settings, falling back to
  `TYPESAFE_BASE_URL` on the daemon, then `https://api.typesafe.ai`. Empty means
  the public endpoint.
- **Model** — `typesafeModel` in plugin settings, falling back to
  `TYPESAFE_DEFAULT_MODEL` on the daemon, then `jev-latest`.

Any server implementing `POST /v1/systemone` with the TypeSafe request/response
shape works as a base URL — point it at a local TypeSafe-compatible server if
you run one.

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
