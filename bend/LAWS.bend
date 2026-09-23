# Public domain under CC0 1.0. See LICENSE and PATENTS.md.
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

import Base
import ./gate.bend as G

# Laws the gate policy must satisfy. These are the spec; PROOF.bend discharges
# them and `bend bend/PROOF.bend` is the build gate for the generated JS.

# 1. Whatever the decision, it carries the judgment's own verdict — the policy
#    never substitutes a different one.
law verdict_preserved:
  for f: G.Freshness
  for p: G.Policy
  for j: G.Judgment
  {G.Decision.verdict(G.Gate.decide(f, p, j)) == G.Judgment.verdict(j) : G.Verdict}

# 2. Stale evidence is never delegated, whatever the numbers say.
law never_delegate_stale:
  for p: G.Policy
  for j: G.Judgment
  {G.Decision.delegated(G.Gate.decide(G.Stale{}, p, j)) == False{} : Bool}

# 3. Below the confidence floor, never delegated.
law never_delegate_low_confidence:
  for p: G.Policy
  for j: G.Judgment
  for low: {U32.is_ge(G.Judgment.confidence(j), G.Policy.min_confidence(p)) == False{} : Bool}
  {G.Decision.delegated(G.Gate.decide(G.Fresh{}, p, j)) == False{} : Bool}

# 4. Without an evidence measurement, never delegated.
law never_delegate_without_evidence:
  for p: G.Policy
  for j: G.Judgment
  for none: {G.Judgment.evidence(j) == None{} : Maybe<&2, U32>}
  {G.Decision.delegated(G.Gate.decide(G.Fresh{}, p, j)) == False{} : Bool}

# 5. Without a risk measurement, never delegated.
law never_delegate_without_risk:
  for p: G.Policy
  for j: G.Judgment
  for none: {G.Judgment.risk(j) == None{} : Maybe<&2, U32>}
  {G.Decision.delegated(G.Gate.decide(G.Fresh{}, p, j)) == False{} : Bool}

# 6. The combinator itself: each failing check blocks delegation regardless of
#    everything after it.
law step_blocks_low_confidence:
  for ev: Maybe<&2, Bool>
  for risk: Maybe<&2, Bool>
  for m: Bool
  for v: G.Verdict
  {G.Decision.delegated(G.Gate.step(False{}, ev, risk, m, v)) == False{} : Bool}

law step_blocks_weak_evidence:
  for c: Bool
  for risk: Maybe<&2, Bool>
  for m: Bool
  for v: G.Verdict
  {G.Decision.delegated(G.Gate.step(c, Some{False{}}, risk, m, v)) == False{} : Bool}

law step_blocks_high_risk:
  for c: Bool
  for ev: Maybe<&2, Bool>
  for m: Bool
  for v: G.Verdict
  {G.Decision.delegated(G.Gate.step(c, ev, Some{False{}}, m, v)) == False{} : Bool}

law step_blocks_ambiguous:
  for c: Bool
  for ev: Maybe<&2, Bool>
  for risk: Maybe<&2, Bool>
  for v: G.Verdict
  {G.Decision.delegated(G.Gate.step(c, ev, risk, False{}, v)) == False{} : Bool}

# 7. Delegation happens exactly when every check passed — no other path in.
#    AllPass is the spec, written independently of Gate.step.
def AllPass(c: Bool, ev: Maybe<&2, Bool>, risk: Maybe<&2, Bool>, m: Bool) -> Bool:
  match c ev risk m:
    case True{} Some{True{}} Some{True{}} True{}:
      True{}
    case _ _ _ _:
      False{}

law step_delegates_iff_all_pass:
  for c: Bool
  for ev: Maybe<&2, Bool>
  for risk: Maybe<&2, Bool>
  for m: Bool
  for v: G.Verdict
  {G.Decision.delegated(G.Gate.step(c, ev, risk, m, v)) == AllPass(c, ev, risk, m) : Bool}

# 8. The policy is not vacuous: some fresh, well-supported judgment is delegated.
law can_delegate:
  exs j: G.Judgment
  {G.Gate.decide(G.Fresh{}, G.Policy.default(), j) == G.Delegate{G.Approve{}} : G.Decision}

# 9. Verdict names round-trip through the wire format.
law verdict_roundtrip:
  for v: G.Verdict
  {G.Verdict.read(G.Verdict.show(v)) == Some{v} : Maybe<&2, G.Verdict>}
