import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  gateRecordRpc,
  launchFoRpc,
  spacedockSettings,
  statusRpc,
} from "./shared/contracts";
import { bootStatus, gateRecord, readyGates } from "./server/cli";
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

  server.handle(launchFoRpc, launchFirstOfficer);

  return registerHooks(server);
}
