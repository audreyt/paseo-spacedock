import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { launchFoRpc } from "../shared/contracts";
import { discoverWorkflowDir, resolveBin } from "./cli";

function resolveSkillPath(explicit?: string): string | null {
  const dirs = [
    explicit,
    process.env.SPACEDOCK_SKILLS_DIR,
    join(homedir(), ".spacedock", "skills"),
  ].filter((dir): dir is string => !!dir);
  for (const dir of dirs) {
    const candidate = join(dir, "first-officer", "SKILL.md");
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
  const skillPath = resolveSkillPath(input.skillsDir);
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
  let provider = input.provider?.trim();
  if (!provider) {
    const availability = await paseo.providers.listAvailable();
    provider = availability.providers.find((p) => p.available)?.provider;
    if (!provider) {
      return { ok: false as const, error: "no available provider on this host" };
    }
  }
  const task = input.task?.trim();
  const prompt = task
    ? `${task}\n\n(You are the first officer. Start with \`spacedock status --boot --json\`.)`
    : "You are the first officer. Run `spacedock status --boot --json` and report the queue and next steps.";
  const agent = await paseo.workspaces.ref(input.workspaceId).agents.create({
    config: {
      provider,
      systemPrompt: lines.join("\n"),
    },
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
