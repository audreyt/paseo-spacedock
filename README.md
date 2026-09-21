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
  provider (empty = first available).

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
