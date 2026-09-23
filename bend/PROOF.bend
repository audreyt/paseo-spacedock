# Public domain under CC0 1.0. See LICENSE and PATENTS.md.
# SPDX-FileCopyrightText: NONE
# SPDX-License-Identifier: CC0-1.0

import Base
import ./gate.bend as G
import ./LAWS.bend as Laws

# Proofs of LAWS.bend. `bend bend/PROOF.bend` prints "All terms check." only when
# every law holds; scripts/bend-build.mjs refuses to regenerate JS otherwise.

# Combinator lemmas
# =================

def step_verdict(c: Bool, ev: Maybe<&2, Bool>, risk: Maybe<&2, Bool>, m: Bool, v: G.Verdict) -> {G.Decision.verdict(G.Gate.step(c, ev, risk, m, v)) == v : G.Verdict}:
  match c ev risk m:
    case False{} _ _ _:
      {==}
    case True{} None{} _ _:
      {==}
    case True{} Some{False{}} _ _:
      {==}
    case True{} Some{True{}} None{} _:
      {==}
    case True{} Some{True{}} Some{False{}} _:
      {==}
    case True{} Some{True{}} Some{True{}} False{}:
      {==}
    case True{} Some{True{}} Some{True{}} True{}:
      {==}

def step_no_evidence(c: Bool, risk: Maybe<&2, Bool>, m: Bool, v: G.Verdict) -> {G.Decision.delegated(G.Gate.step(c, None{}, risk, m, v)) == False{} : Bool}:
  match c:
    case False{}:
      {==}
    case True{}:
      {==}

def step_no_risk(c: Bool, ev: Maybe<&2, Bool>, m: Bool, v: G.Verdict) -> {G.Decision.delegated(G.Gate.step(c, ev, None{}, m, v)) == False{} : Bool}:
  match c ev:
    case False{} _:
      {==}
    case True{} None{}:
      {==}
    case True{} Some{False{}}:
      {==}
    case True{} Some{True{}}:
      {==}

# Laws
# ====

def Laws.verdict_preserved(f, p, j):
  match f p j:
    case G.Stale{} _ _:
      {==}
    case G.Fresh{} G.Policy{mc, me, mr, mm} G.Judgment{+v, c, pa, pr, ph, e, r}:
      step_verdict(U32.is_ge(c, mc), G.Gate.at_least(e, me), G.Gate.at_most(r, mr), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)

def Laws.never_delegate_stale(p, j):
  {==}

def Laws.never_delegate_low_confidence(p, j, low):
  match p j:
    case G.Policy{mc, me, mr, mm} G.Judgment{+v, c, pa, pr, ph, e, r}:
      %Equal.sym(Bool, U32.is_ge(c, mc), False{}, low) : {G.Decision.delegated(G.Gate.step(_, G.Gate.at_least(e, me), G.Gate.at_most(r, mr), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)) == False{} : Bool}
      {==}

def Laws.never_delegate_without_evidence(p, j, none):
  match p j:
    case G.Policy{mc, me, mr, mm} G.Judgment{+v, c, pa, pr, ph, e, r}:
      %Equal.sym(Maybe<&2, U32>, e, None{}, none) : {G.Decision.delegated(G.Gate.step(U32.is_ge(c, mc), G.Gate.at_least(_, me), G.Gate.at_most(r, mr), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)) == False{} : Bool}
      step_no_evidence(U32.is_ge(c, mc), G.Gate.at_most(r, mr), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)

def Laws.never_delegate_without_risk(p, j, none):
  match p j:
    case G.Policy{mc, me, mr, mm} G.Judgment{+v, c, pa, pr, ph, e, r}:
      %Equal.sym(Maybe<&2, U32>, r, None{}, none) : {G.Decision.delegated(G.Gate.step(U32.is_ge(c, mc), G.Gate.at_least(e, me), G.Gate.at_most(_, mr), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)) == False{} : Bool}
      step_no_risk(U32.is_ge(c, mc), G.Gate.at_least(e, me), G.Judgment.margin_ok(v, pa, pr, ph, mm), v)

def Laws.step_blocks_low_confidence(ev, risk, m, v):
  {==}

def Laws.step_blocks_weak_evidence(c, risk, m, v):
  match c:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.step_blocks_high_risk(c, ev, m, v):
  match c ev:
    case False{} _:
      {==}
    case True{} None{}:
      {==}
    case True{} Some{False{}}:
      {==}
    case True{} Some{True{}}:
      {==}

def Laws.step_blocks_ambiguous(c, ev, risk, v):
  match c ev risk:
    case False{} _ _:
      {==}
    case True{} None{} _:
      {==}
    case True{} Some{False{}} _:
      {==}
    case True{} Some{True{}} None{}:
      {==}
    case True{} Some{True{}} Some{False{}}:
      {==}
    case True{} Some{True{}} Some{True{}}:
      {==}

def Laws.step_delegates_iff_all_pass(c, ev, risk, m, v):
  match c ev risk m:
    case False{} _ _ _:
      {==}
    case True{} None{} _ _:
      {==}
    case True{} Some{False{}} _ _:
      {==}
    case True{} Some{True{}} None{} _:
      {==}
    case True{} Some{True{}} Some{False{}} _:
      {==}
    case True{} Some{True{}} Some{True{}} False{}:
      {==}
    case True{} Some{True{}} Some{True{}} True{}:
      {==}

def Laws.can_delegate():
  (G.Judgment{G.Approve{}, 9000, 8000, 1000, 1000, Some{9000}, Some{1000}}, {==})

def Laws.verdict_roundtrip(v):
  match v:
    case G.Approve{}:
      {==}
    case G.Revise{}:
      {==}
    case G.Hold{}:
      {==}
