import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  gateRecordRpc,
  judgeGateRpc,
  launchFoRpc,
  spacedockSettings,
  statusRpc,
} from "./shared/contracts";
import { bootStatus, gateRecord, readyGates } from "./server/cli";
import { gatherGateState, judgeGate } from "./server/judge";
import { registerHooks } from "./server/hooks";
import { launchFirstOfficer } from "./server/launch";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(spacedockSettings);

  server.handle(statusRpc, async ({ cwd, bin }) => {
    try {
      const result = await bootStatus(cwd, bin);
      if (result.status === "error") {
        return { found: false as const, error: result.error };
      }
      return {
        found: true as const,
        workflowDir: result.workflowDir,
        boot: result.boot,
      };
    } catch (error) {
      return { found: false as const, error: String(error) };
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

  server.handle(judgeGateRpc, async (input) => {
    const apiKey = input.apiKey || process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "no TypeSafe API key — set typesafeApiKey in plugin settings",
      };
    }
    const gates = await readyGates(input.workflowDir, input.bin).catch(() => []);
    const gate = gates.find(
      (g) => g.slug === input.entity || g.id === input.entity,
    );
    if (!gate) {
      return { ok: false, error: `no ready gate for ${input.entity}` };
    }
    try {
      const state = await gatherGateState(input.workflowDir, gate);
      const result = await judgeGate(state, apiKey, {
        baseUrl: input.baseUrl || undefined,
        model: input.model || undefined,
      });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  server.handle(launchFoRpc, launchFirstOfficer);

  return registerHooks(server);
}
