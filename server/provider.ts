// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type Selection =
  | { ok: true; provider: string; modeId?: string; thinkingOptionId?: string }
  | { ok: false; error: string };

interface AgentProfile {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
}

interface SnapshotModel {
  id: string;
  isDefault?: boolean;
}

interface SnapshotEntry {
  provider: string;
  enabled?: boolean;
  models?: SnapshotModel[];
}

export async function resolveAgentSelection(
  paseo: PluginHandlerContext["paseo"],
  requested?: string,
): Promise<Selection> {
  const req = requested?.trim();
  if (req && req.includes("/")) {
    return { ok: true, provider: req };
  }

  let profiles: AgentProfile[] = [];
  try {
    const configResult = await paseo.config.get();
    profiles = (configResult.config.agentProfiles as AgentProfile[] | undefined) ?? [];
  } catch {
    profiles = [];
  }

  const available: string[] = (
    await paseo.providers.listAvailable()
  ).providers.filter((p) => p.available).map((p) => p.provider);

  if (req) {
    if (!available.includes(req)) {
      return { ok: false, error: `provider ${req} is not available on this host` };
    }
    const profile = profiles.find((p) => p.provider === req && p.model);
    if (profile) {
      return {
        ok: true,
        provider: `${req}/${profile.model}`,
        modeId: profile.modeId,
        thinkingOptionId: profile.thinkingOptionId,
      };
    }
    return await fallbackToSnapshot(paseo, req);
  }

  const profile = profiles.find(
    (p) => available.includes(p.provider) && p.model,
  );
  if (profile) {
    return {
      ok: true,
      provider: `${profile.provider}/${profile.model}`,
      modeId: profile.modeId,
      thinkingOptionId: profile.thinkingOptionId,
    };
  }

  for (const provider of available) {
    const sel = await fallbackToSnapshot(paseo, provider);
    if (sel.ok) return sel;
  }

  return {
    ok: false,
    error:
      "no default model for any available provider — set the provider as provider/model in plugin settings (e.g. omp/<model>) or create an agent profile for it in Paseo",
  };
}

async function fallbackToSnapshot(
  paseo: PluginHandlerContext["paseo"],
  provider: string,
): Promise<Selection> {
  let entries: SnapshotEntry[] = [];
  try {
    const snapshot = await paseo.providers.snapshot();
    entries = (snapshot.entries as SnapshotEntry[] | undefined) ?? [];
  } catch {
    entries = [];
  }
  const entry = entries.find((e) => e.provider === provider);
  const def = entry?.models?.find((m) => m.isDefault);
  if (def) {
    return { ok: true, provider: `${provider}/${def.id}` };
  }
  return {
    ok: false,
    error: `no default model for ${provider} — set the provider as provider/model in plugin settings (e.g. ${provider}/<model>) or create an agent profile for it in Paseo`,
  };
}
