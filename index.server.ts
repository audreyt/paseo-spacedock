// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  bootstrapRpc,
  gateRecordRpc,
  gatesRpc,
  judgeGateRpc,
  launchFoRpc,
  spacedockSettings,
  statusRpc,
} from "./shared/contracts";
import {
  bootStatus,
  discoverWorkflowDir,
  gateRecord,
  isNoWorkflowError,
  nextState,
  readyGates,
} from "./server/cli";
import { inferSuggestion, launchCommissionAgent, scaffoldWorkflow } from "./server/bootstrap";
import { gatherGateState, judgeGate } from "./server/judge";
import { registerHooks } from "./server/hooks";
import { launchFirstOfficer } from "./server/launch";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(spacedockSettings);

  server.handle(statusRpc, async ({ cwd, bin }) => {
    try {
      const result = await bootStatus(cwd, bin);
      if (result.status === "error") {
        if (isNoWorkflowError(result.error)) {
          return {
            found: false as const,
            reason: "no-workflow" as const,
            error: result.error,
            suggest: inferSuggestion(cwd, { bin }),
          };
        }
        try {
          const discovered = await discoverWorkflowDir(cwd, bin);
          if (discovered === null) {
            return {
              found: false as const,
              reason: "no-workflow" as const,
              error: result.error,
              suggest: inferSuggestion(cwd, { bin }),
            };
          }
        } catch {
          // discovery threw — treat as a generic error, not no-workflow
        }
        return { found: false as const, reason: "error" as const, error: result.error };
      }
      return {
        found: true as const,
        workflowDir: result.workflowDir,
        boot: result.boot,
      };
    } catch (error) {
      return { found: false as const, reason: "error" as const, error: String(error) };
    }
  });

  server.handle(gateRecordRpc, async (input, { paseo }) => {
    let result;
    try {
      result = await gateRecord(input);
    } catch (error) {
      return { ok: false, output: String(error), gates: undefined };
    }
    let gates;
    if (result.ok && input.agentId) {
      gates = await readyGates(input.workflowDir, input.bin).catch(() => undefined);
      if (gates) {
        await paseo.agents
          .ref(input.agentId)
          .timeline.append({
            type: "plugin",
            id: "spacedock-gates",
            kind: "spacedock-gates",
            version: 1,
            data: { workflowDir: input.workflowDir, gates },
          })
          .catch(() => {});
      }
    }
    return { ok: result.ok, output: result.output, gates };
  });

  server.handle(gatesRpc, async (input) => nextState(input.workflowDir, input.bin));

  server.handle(judgeGateRpc, async (input) => {
    const apiKey = input.apiKey || process.env.TYPESAFE_API_KEY || undefined;
    const gates = await readyGates(input.workflowDir, input.bin).catch(() => []);
    const gate = gates.find(
      (g) => g.slug === input.entity || g.id === input.entity,
    );
    if (!gate) {
      const current = await nextState(input.workflowDir, input.bin)
        .then((s) => s.currentOf[input.entity])
        .catch(() => undefined);
      const where = current ? ` (at ${current})` : "";
      return {
        ok: false,
        error: `No gate is waiting for ${input.entity} right now${where}.`,
      };
    }
    try {
      const state = await gatherGateState(input.workflowDir, gate);
      const digest = (state.gate as { digest?: string | null }).digest ?? null;
      const fresh = !input.expectDigest || input.expectDigest === digest;
      const result = await judgeGate(state, apiKey, {
        baseUrl: input.baseUrl || undefined,
        model: input.model || undefined,
        fresh,
      });
      const { decision, ...rest } = result;
      return {
        ok: true,
        ...rest,
        digest,
        stamp: decision.stamp,
        policy: {
          mode: decision.mode,
          verdict: decision.verdict,
          reason: decision.reason,
          text: decision.text,
        },
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  server.handle(launchFoRpc, launchFirstOfficer);

  server.handle(bootstrapRpc, async (input, { paseo }) => {
    const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
    const cwd = workspace?.workspaceDirectory;
    if (!cwd) {
      return { ok: false, error: "workspace directory unknown" };
    }
    const scaffold = await scaffoldWorkflow({
      cwd,
      dir: input.dir,
      mission: input.mission,
      entityLabel: input.entityLabel,
      bin: input.bin,
    });
    if (!scaffold.ok) {
      return { ok: false, error: scaffold.error };
    }
    let agentId: string | undefined;
    let agentError: string | undefined;
    if (input.launchAgent) {
      const agent = await launchCommissionAgent(
        {
          workspaceId: input.workspaceId,
          cwd,
          workflowDir: scaffold.workflowDir,
          mission: input.mission,
          provider: input.provider,
          bin: input.bin,
          skillsDir: input.skillsDir,
        },
        { paseo },
      );
      if ("agentId" in agent) {
        agentId = agent.agentId;
      } else {
        agentError = agent.error;
      }
    }
    return {
      ok: true,
      workflowDir: scaffold.workflowDir,
      created: scaffold.created,
      agentId,
      agentError,
      notes: scaffold.notes,
      warning: scaffold.warning,
    };
  });

  return registerHooks(server);
}
