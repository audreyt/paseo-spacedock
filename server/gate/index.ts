// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

import { Gate, type Decision, type Judgment, type Verdict } from "./gate.generated.js";

export const bp = (x: number) => Math.max(0, Math.min(10000, Math.round(x * 10000)));

export function toJudgment(input: {
  verdict: string;
  confidence: number;
  probabilities: Record<string, number>;
  evidence: number | null;
  risk: number | null;
}): Judgment {
  const read = Gate.readVerdict(input.verdict);
  if (read.$ === "None") {
    throw new Error(`invalid verdict: ${input.verdict}`);
  }
  const verdict: Verdict = read.value;
  return {
    $: "Judgment",
    verdict,
    confidence: bp(input.confidence),
    p_approve: bp(input.probabilities.approve ?? 0),
    p_revise: bp(input.probabilities.revise ?? 0),
    p_hold: bp(input.probabilities.hold ?? 0),
    evidence: input.evidence != null ? { $: "Some", value: bp(input.evidence) } : { $: "None" },
    risk: input.risk != null ? { $: "Some", value: bp(input.risk / 2) } : { $: "None" },
  };
}

export interface GateDecision {
  mode: "delegate" | "advise";
  verdict: "approve" | "revise" | "hold";
  reason?: string;
  text: string;
  stamp: string;
}

export function decideGate(j: Judgment, fresh: boolean): GateDecision {
  const d: Decision = Gate.decide(
    { $: fresh ? "gate.Fresh" : "gate.Stale" },
    Gate.policyDefault(),
    j,
  );
  const verdict = Gate.showVerdict(d.verdict) as GateDecision["verdict"];
  const mode: GateDecision["mode"] = d.$ === "Delegate" ? "delegate" : "advise";
  const reason = d.$ === "Advise" ? Gate.showReason(d.reason) : undefined;
  return {
    mode,
    verdict,
    reason,
    text: Gate.showDecision(d),
    stamp: Gate.stamp(j),
  };
}
