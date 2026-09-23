// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import type { PluginServerContext } from "@getpaseo/plugin/server";
import { discoverWorkflowDir, readyGates, resolveBin } from "./cli";

const parentByAgent = new Map<string, string | null>();
const cardedAgents = new Set<string>();

export function registerHooks(server: PluginServerContext): () => void {
  const removers = [
    server.on("agent.created", (event) => {
      parentByAgent.set(event.agent.id, event.agent.parentAgentId);
    }),

    server.before("agent.session_open", async ({ request }, { paseo }) => {
      const workflowDir = await discoverWorkflowDir(request.cwd).catch(() => null);
      if (!workflowDir) return;
      let role: string | undefined;
      try {
        const result = await paseo.agents.ref(request.agentId).refresh();
        role = result?.agent.labels?.["spacedock.role"];
      } catch {
        // Snapshot unavailable; fall back to parentage.
      }
      if (!role && parentByAgent.get(request.agentId)) role = "ensign";
      const env: Record<string, string> = {
        ...request.env,
        SPACEDOCK_BIN: resolveBin(),
        SPACEDOCK_WORKFLOW_DIR: workflowDir,
      };
      if (role) env.PASEO_SPACEDOCK_ROLE = role;
      return { ...request, env };
    }),

    server.on("agent.turn_ended", async (event, { paseo }) => {
      if (event.outcome.kind === "canceled") return;
      const workflowDir = await discoverWorkflowDir(event.agent.cwd).catch(() => null);
      if (!workflowDir) return;
      const gates = await readyGates(workflowDir).catch(() => []);
      if (gates.length === 0 && !cardedAgents.has(event.agent.id)) return;
      try {
        await paseo.agents.ref(event.agent.id).timeline.append({
          type: "plugin",
          id: "spacedock-gates",
          kind: "spacedock-gates",
          version: 1,
          data: { workflowDir, gates },
        });
        if (gates.length > 0) cardedAgents.add(event.agent.id);
        else cardedAgents.delete(event.agent.id);
      } catch {
        // Timeline append is best effort; the panel is the durable surface.
      }
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
