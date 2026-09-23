// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { BootStatus, ReadyGate } from "../shared/contracts";

const BIN_CANDIDATES = [
  "/opt/homebrew/bin/spacedock",
  "/usr/local/bin/spacedock",
  "/opt/homebrew/opt/spacedock/bin/spacedock",
];

let rememberedBin: string | null = null;

export function resolveBin(explicit?: string): string {
  if (explicit) {
    rememberedBin = explicit;
    return explicit;
  }
  if (rememberedBin) return rememberedBin;
  const fromEnv = process.env.PASEO_SPACEDOCK_BIN;
  if (fromEnv) {
    rememberedBin = fromEnv;
    return fromEnv;
  }
  for (const candidate of BIN_CANDIDATES) {
    if (existsSync(candidate)) {
      rememberedBin = candidate;
      return candidate;
    }
  }
  return "spacedock";
}

export function forgetDiscovery(cwd: string): void {
  discoveryCache.delete(cwd);
}

export function isNoWorkflowError(text: string): boolean {
  return text.includes("no commissioned Spacedock workflow found");
}

export async function spacedockVersion(bin?: string): Promise<string | null> {
  const result = await run(resolveBin(bin), ["--version"], process.cwd());
  if (result.code !== 0) return null;
  const firstLine = result.stdout.split("\n", 1)[0] ?? "";
  const match = firstLine.match(/^spacedock\s+(\S+)/);
  return match ? match[1] : null;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: number }).code !== "number") {
          reject(error);
          return;
        }
        resolve({
          code: typeof (error as { code?: number } | null)?.code === "number"
            ? (error as { code: number }).code
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const discoveryCache = new Map<string, { dir: string | null; at: number }>();
const DISCOVERY_TTL_MS = 15_000;

export async function discoverWorkflowDir(
  cwd: string,
  bin?: string,
): Promise<string | null> {
  const cached = discoveryCache.get(cwd);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.dir;
  const result = await run(resolveBin(bin), ["status", "--discover"], cwd);
  const dir = result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  discoveryCache.set(cwd, { dir, at: Date.now() });
  return dir;
}

export async function bootStatus(
  cwd: string,
  bin?: string,
): Promise<
  | { status: "ok"; workflowDir: string; boot: BootStatus }
  | { status: "error"; error: string }
> {
  const result = await run(
    resolveBin(bin),
    ["status", "--boot", "--json", "--identify"],
    cwd,
  );
  if (result.code !== 0 || !result.stdout.trim().startsWith("{")) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      status: "error",
      error: detail || "no commissioned Spacedock workflow found",
    };
  }
  const boot = JSON.parse(result.stdout) as BootStatus;
  const workflowDir = boot.definition_dir ?? (await discoverWorkflowDir(cwd, bin));
  if (!workflowDir) {
    return { status: "error", error: "workflow discovery returned no directory" };
  }
  return { status: "ok", workflowDir, boot };
}

export interface NextState {
  gates: ReadyGate[];
  currentOf: Record<string, string>;
}

export async function nextState(
  workflowDir: string,
  bin?: string,
): Promise<NextState> {
  const empty: NextState = { gates: [], currentOf: {} };
  const result = await run(
    resolveBin(bin),
    ["status", "--next", "--json", "--workflow-dir", workflowDir],
    workflowDir,
  );
  if (result.code !== 0 || !result.stdout.trim().startsWith("{")) return empty;
  let parsed: {
    ready_gates?: ReadyGate[];
    dispatchable?: Array<{ id?: string; slug?: string; current?: string }>;
  };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return empty;
  }
  const currentOf: Record<string, string> = {};
  for (const d of parsed.dispatchable ?? []) {
    if (d.current) {
      if (d.slug) currentOf[d.slug] = d.current;
      if (d.id) currentOf[d.id] = d.current;
    }
  }
  return { gates: parsed.ready_gates ?? [], currentOf };
}

export async function readyGates(
  workflowDir: string,
  bin?: string,
): Promise<ReadyGate[]> {
  return (await nextState(workflowDir, bin).catch(() => null))?.gates ?? [];
}

export async function gateRecord(input: {
  workflowDir: string;
  entity: string;
  decision: "approve" | "revise" | "hold";
  reason?: string;
  consume?: boolean;
  bin?: string;
}): Promise<{ ok: boolean; output: string }> {
  if (
    (input.decision === "revise" || input.decision === "hold") &&
    !input.reason?.trim()
  ) {
    return {
      ok: false,
      output: "Hold and Revise need a reason — type one and retry.",
    };
  }
  const args = [
    "gate",
    "record",
    input.entity,
    "--workflow-dir",
    input.workflowDir,
    "--decision",
    input.decision,
    "--actor",
    "person:captain",
  ];
  if (input.reason) args.push("--reason", input.reason);
  if (input.consume && input.decision === "approve") args.push("--consume");
  const result = await run(resolveBin(input.bin), args, input.workflowDir);
  const output = (result.stdout + result.stderr).trim();
  if (result.code === 0) return { ok: true, output };
  return {
    ok: false,
    output: await translateRecordError(input, output),
  };
}

async function translateRecordError(
  input: { workflowDir: string; entity: string; bin?: string },
  raw: string,
): Promise<string> {
  if (raw.includes("requires --reason")) {
    return "Hold and Revise need a reason — type one and retry.";
  }
  if (raw.includes("not an actionable")) {
    const current = await nextState(input.workflowDir, input.bin)
      .then((s) => s.currentOf[input.entity])
      .catch(() => undefined);
    const where = current
      ? ` is at stage ${current}, which has no gate`
      : " is no longer at a gate stage";
    return `${input.entity}${where} — nothing to record. Refresh for the current list.`;
  }
  return raw || "gate record failed";
}
