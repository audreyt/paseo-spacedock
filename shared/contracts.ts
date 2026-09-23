// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const readyGate = z.object({
  id: z.string(),
  slug: z.string(),
  current: z.string(),
  readiness: z.string(),
});
export type ReadyGate = z.output<typeof readyGate>;

export const stage = z.looseObject({
  name: z.string(),
  worktree: z.string().optional(),
  gate: z.string().optional(),
  terminal: z.string().optional(),
  initial: z.string().optional(),
  model: z.string().optional(),
});
export type Stage = z.output<typeof stage>;

// `spacedock status --boot --json --identify` payload. Loose: the binary owns the
// key set and appends over time.
export const bootStatus = z.looseObject({
  command: z.string().optional(),
  mods: z.record(z.string(), z.array(z.string())).optional(),
  dispatchable: z.array(z.record(z.string(), z.unknown())).optional(),
  ready_gates: z.array(readyGate).optional(),
  stages: z.array(stage).optional(),
  orphans: z.array(z.record(z.string(), z.unknown())).optional(),
  pr_state: z
    .looseObject({
      status: z.string().optional(),
      entries: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
  team_state: z
    .looseObject({ present: z.string().optional(), hint: z.string().optional() })
    .optional(),
  state_backend: z.string().optional(),
  definition_dir: z.string().optional(),
  entity_dir: z.string().optional(),
  entity_dir_present: z.string().optional(),
  state_remote: z.string().optional(),
  sandbox: z.string().optional(),
  next_id: z.string().optional(),
});
export type BootStatus = z.output<typeof bootStatus>;

export const gatesTimelineData = z.object({
  workflowDir: z.string(),
  gates: z.array(readyGate),
});
export type GatesTimelineData = z.output<typeof gatesTimelineData>;

export const spacedockSettings = defineSettings({
  id: "spacedock",
  scope: "host",
  version: 1,
  schema: z.object({
    binaryPath: z.string().default(""),
    skillsDir: z.string().default(""),
    foProvider: z.string().default(""),
    typesafeApiKey: z.string().default(""),
    typesafeBaseUrl: z.string().default(""),
    typesafeModel: z.string().default(""),
  }),
});

export const workflowSuggestion = z.object({
  dir: z.string(),
  mission: z.string(),
  entityLabel: z.string(),
  gitRepo: z.boolean(),
  skillFound: z.boolean(),
  hidden: z
    .object({
      kind: z.enum(["spacedock-prune", "git-ignored"]),
      pattern: z.string(),
      source: z.string().optional(),
      line: z.number().optional(),
    })
    .nullable()
    .optional(),
  note: z.string().optional(),
});
export type WorkflowSuggestion = z.output<typeof workflowSuggestion>;

export const statusRpc = defineRpc({
  name: "spacedock.status",
  input: z.object({ cwd: z.string(), bin: z.string().optional() }),
  output: z.discriminatedUnion("found", [
    z.object({
      found: z.literal(false),
      reason: z.enum(["no-workflow", "error"]),
      error: z.string().optional(),
      suggest: workflowSuggestion.optional(),
    }),
    z.object({
      found: z.literal(true),
      workflowDir: z.string(),
      boot: bootStatus,
    }),
  ]),
});

export const bootstrapRpc = defineRpc({
  name: "spacedock.workflow.bootstrap",
  input: z.object({
    workspaceId: z.string(),
    dir: z.string(),
    mission: z.string(),
    entityLabel: z.string().optional(),
    launchAgent: z.boolean(),
    provider: z.string().optional(),
    bin: z.string().optional(),
    skillsDir: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    workflowDir: z.string().optional(),
    created: z.array(z.string()).optional(),
    agentId: z.string().optional(),
    agentError: z.string().optional(),
    error: z.string().optional(),
    notes: z.array(z.string()).optional(),
    warning: z.string().optional(),
  }),
});

export const gateRecordRpc = defineRpc({
  name: "spacedock.gate.record",
  input: z.object({
    workflowDir: z.string(),
    entity: z.string(),
    decision: z.enum(["approve", "revise", "hold"]),
    reason: z.string().optional(),
    consume: z.boolean().optional(),
    agentId: z.string().optional(),
    bin: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    output: z.string(),
    gates: z.array(readyGate).optional(),
  }),
});

export const gatesRpc = defineRpc({
  name: "spacedock.gates.refresh",
  input: z.object({ workflowDir: z.string(), bin: z.string().optional() }),
  output: z.object({
    gates: z.array(readyGate),
    currentOf: z.record(z.string(), z.string()),
  }),
});

export const judgeGateRpc = defineRpc({
  name: "spacedock.gate.judge",
  input: z.object({
    workflowDir: z.string(),
    entity: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    expectDigest: z.string().optional(),
    bin: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    verdict: z.string().optional(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
    evidence: z.number().nullable().optional(),
    risk: z.number().nullable().optional(),
    model: z.string().optional(),
    digest: z.string().nullable().optional(),
    stamp: z.string().optional(),
    policy: z
      .object({
        mode: z.enum(["delegate", "advise"]),
        verdict: z.enum(["approve", "revise", "hold"]),
        reason: z.string().optional(),
        text: z.string(),
      })
      .optional(),
  }),
});

export const launchFoRpc = defineRpc({
  name: "spacedock.fo.launch",
  input: z.object({
    workspaceId: z.string(),
    provider: z.string().optional(),
    task: z.string().optional(),
    bin: z.string().optional(),
    skillsDir: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    agentId: z.string().optional(),
    workflowDir: z.string().optional(),
    error: z.string().optional(),
  }),
});
