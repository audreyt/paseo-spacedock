// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { launchFoRpc } from "../shared/contracts";
import { discoverWorkflowDir, resolveBin } from "./cli";
import { resolveAgentSelection } from "./provider";

export function resolveSkillPath(name: string, explicit?: string): string | null {
  const dirs = [
    explicit,
    process.env.SPACEDOCK_SKILLS_DIR,
    join(homedir(), ".spacedock", "skills"),
  ].filter((dir): dir is string => !!dir);
  for (const dir of dirs) {
    const candidate = join(dir, name, "SKILL.md");
    if (existsSync(candidate)) return candidate;
  }
  for (const cacheRoot of hostPluginCacheRoots()) {
    const marketplaceDirs = listDirs(cacheRoot);
    for (const marketplace of marketplaceDirs) {
      const spacedockDir = join(cacheRoot, marketplace, "spacedock");
      const versionDirs = listDirs(spacedockDir);
      if (versionDirs.length === 0) continue;
      const latest = versionDirs.sort().at(-1);
      if (!latest) continue;
      const candidate = join(spacedockDir, latest, "skills", name, "SKILL.md");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function hostPluginCacheRoots(): string[] {
  const roots = [
    join(homedir(), ".claude", "plugins", "cache"),
    join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "plugins", "cache"),
  ];
  return roots.filter((dir) => existsSync(dir));
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function launchFirstOfficer(
  input: RpcInput<typeof launchFoRpc>,
  { paseo }: PluginHandlerContext,
) {
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  const cwd = workspace?.workspaceDirectory;
  if (!cwd) return { ok: false as const, error: "workspace directory unknown" };
  const workflowDir = await discoverWorkflowDir(cwd, input.bin);
  if (!workflowDir) {
    return {
      ok: false as const,
      error: `no commissioned Spacedock workflow found under ${cwd}`,
    };
  }
  const bin = resolveBin(input.bin);
  const skillPath = resolveSkillPath("first-officer", input.skillsDir);
  const lines = [
    `You are the Spacedock first officer for the commissioned workflow at ${workflowDir}.`,
    "You dispatch and gate work; subagents (ensigns) implement. Do not implement gated stages yourself.",
    "Start with `spacedock status --boot --json --identify`, then `spacedock status --next` for the queue.",
    "Prepare gates with `spacedock gate prepare`; the captain records decisions. Never record your own gate decision.",
    "Use `spacedock dispatch build` for packaged worker dispatch artifacts.",
  ];
  if (skillPath) {
    lines.push(`Read your operating contract at ${skillPath} before acting.`);
  }
  const sel = await resolveAgentSelection(paseo, input.provider);
  if (!sel.ok) {
    return { ok: false as const, error: sel.error };
  }
  const config: {
    provider: string;
    modeId?: string;
    thinkingOptionId?: string;
    systemPrompt: string;
  } = { provider: sel.provider, systemPrompt: lines.join("\n") };
  if (sel.modeId) config.modeId = sel.modeId;
  if (sel.thinkingOptionId) config.thinkingOptionId = sel.thinkingOptionId;
  const task = input.task?.trim();
  const prompt = task
    ? `${task}\n\n(You are the first officer. Start with \`spacedock status --boot --json\`.)`
    : "You are the first officer. Run `spacedock status --boot --json` and report the queue and next steps.";
  const agent = await paseo.workspaces.ref(input.workspaceId).agents.create({
    config,
    title: "First Officer",
    prompt,
    env: {
      SPACEDOCK_BIN: bin,
      SPACEDOCK_WORKFLOW_DIR: workflowDir,
      PASEO_SPACEDOCK_ROLE: "first-officer",
    },
    labels: { "spacedock.role": "first-officer" },
  });
  return { ok: true as const, agentId: agent.id, workflowDir };
}
