// Public domain under CC0 1.0. See LICENSE and PATENTS.md.
// SPDX-FileCopyrightText: NONE
// SPDX-License-Identifier: CC0-1.0

export type Verdict =
  | { $: "gate.Approve" }
  | { $: "gate.Revise" }
  | { $: "gate.Hold" };
export type Freshness = { $: "gate.Fresh" } | { $: "gate.Stale" };
export type Maybe<T> = { $: "None" } | { $: "Some"; value: T };
export interface Judgment {
  $: "Judgment";
  verdict: Verdict;
  confidence: number;
  p_approve: number;
  p_revise: number;
  p_hold: number;
  evidence: Maybe<number>;
  risk: Maybe<number>;
}
export interface Policy {
  $: "Policy";
  min_confidence: number;
  min_evidence: number;
  max_risk: number;
  min_margin: number;
}
export type Reason =
  | { $: "gate.StaleEvidence" }
  | { $: "gate.LowConfidence" }
  | { $: "gate.NoEvidence" }
  | { $: "gate.WeakEvidence" }
  | { $: "gate.UnknownRisk" }
  | { $: "gate.HighRisk" }
  | { $: "gate.Ambiguous" };
export type Decision =
  | { $: "Delegate"; verdict: Verdict }
  | { $: "Advise"; verdict: Verdict; reason: Reason };
export declare const Gate: {
  decide(f: Freshness, p: Policy, j: Judgment): Decision;
  policyDefault(): Policy;
  stamp(j: Judgment): string;
  showDecision(d: Decision): string;
  showReason(r: Reason): string;
  showVerdict(v: Verdict): string;
  readVerdict(s: string): Maybe<Verdict>;
  showBp(bp: number): string;
};
