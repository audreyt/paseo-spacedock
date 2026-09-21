import Base

# Gate judgment policy for paseo-spacedock.
#
# A TypeSafe/Jev answer is turned into a Judgment by the host (JS). This module
# owns everything deterministic that follows: whether the plugin may treat the
# answer as a delegated decision or must only advise the captain, and why.
#
# Every ratio is expressed in basis points (0..10000) as a U32.

type Verdict is Data:
  Approve{}
  Revise{}
  Hold{}

type Freshness is Data:
  Fresh{}
  Stale{}

type Judgment is Data:
  Judgment{
    verdict: Verdict,
    confidence: U32,
    p_approve: U32,
    p_revise: U32,
    p_hold: U32,
    evidence: Maybe<&2, U32>,
    risk: Maybe<&2, U32>
  }

type Policy is Data:
  Policy{
    min_confidence: U32,
    min_evidence: U32,
    max_risk: U32,
    min_margin: U32
  }

type Reason is Data:
  StaleEvidence{}
  LowConfidence{}
  NoEvidence{}
  WeakEvidence{}
  UnknownRisk{}
  HighRisk{}
  Ambiguous{}

type Decision is Data:
  Delegate{verdict: Verdict}
  Advise{verdict: Verdict, reason: Reason}

# Verdict
# =======

def Verdict.show(v: Verdict) -> String:
  match v:
    case Approve{}:
      "approve"
    case Revise{}:
      "revise"
    case Hold{}:
      "hold"

def Verdict.read.go(a: Bool, r: Bool, h: Bool) -> Maybe<&2, Verdict>:
  match a r h:
    case True{} _ _:
      Some{Approve{}}
    case False{} True{} _:
      Some{Revise{}}
    case False{} False{} True{}:
      Some{Hold{}}
    case False{} False{} False{}:
      None{}

def Verdict.read(+s: String) -> Maybe<&2, Verdict>:
  Verdict.read.go(String.eq(s, "approve"), String.eq(s, "revise"), String.eq(s, "hold"))

# Accessors
# =========

def Judgment.verdict(j: Judgment) -> Verdict:
  match j:
    case Judgment{v, c, pa, pr, ph, e, r}:
      v

def Judgment.confidence(j: Judgment) -> U32:
  match j:
    case Judgment{v, c, pa, pr, ph, e, r}:
      c

def Judgment.evidence(j: Judgment) -> Maybe<&2, U32>:
  match j:
    case Judgment{v, c, pa, pr, ph, e, r}:
      e

def Judgment.risk(j: Judgment) -> Maybe<&2, U32>:
  match j:
    case Judgment{v, c, pa, pr, ph, e, r}:
      r

def Policy.min_confidence(p: Policy) -> U32:
  match p:
    case Policy{mc, me, mr, mm}:
      mc

def Decision.verdict(d: Decision) -> Verdict:
  match d:
    case Delegate{v}:
      v
    case Advise{v, r}:
      v

def Decision.delegated(d: Decision) -> Bool:
  match d:
    case Delegate{v}:
      True{}
    case Advise{v, r}:
      False{}

def Reason.show(r: Reason) -> String:
  match r:
    case StaleEvidence{}:
      "stale-evidence"
    case LowConfidence{}:
      "low-confidence"
    case NoEvidence{}:
      "no-evidence"
    case WeakEvidence{}:
      "weak-evidence"
    case UnknownRisk{}:
      "unknown-risk"
    case HighRisk{}:
      "high-risk"
    case Ambiguous{}:
      "ambiguous"

# Policy
# ======

# Conservative defaults: 70% confidence, 60% evidence support, risk at most a
# third of the scale, and the chosen option must lead the runner-up by 20 points.
def Policy.default() -> Policy:
  Policy{7000, 6000, 3300, 2000}

# The chosen option must beat the best other option by at least min_margin.
def Judgment.margin_ok(v: Verdict, +pa: U32, +pr: U32, +ph: U32, mm: U32) -> Bool:
  match v:
    case Approve{}:
      U32.is_ge(pa, (U32.max(pr, ph) + mm : U32))
    case Revise{}:
      U32.is_ge(pr, (U32.max(pa, ph) + mm : U32))
    case Hold{}:
      U32.is_ge(ph, (U32.max(pa, pr) + mm : U32))

# A missing measurement is None, never silently passing.
def Gate.at_least(e: Maybe<&2, U32>, min: U32) -> Maybe<&2, Bool>:
  match e:
    case None{}:
      None{}
    case Some{x}:
      Some{U32.is_ge(x, min)}

def Gate.at_most(e: Maybe<&2, U32>, max: U32) -> Maybe<&2, Bool>:
  match e:
    case None{}:
      None{}
    case Some{x}:
      Some{U32.is_le(x, max)}

# The combinator: every check must pass, in this priority order, or the plugin
# only advises. The first failing check names the reason.
def Gate.step(conf_ok: Bool, ev: Maybe<&2, Bool>, risk: Maybe<&2, Bool>, margin_ok: Bool, v: Verdict) -> Decision:
  match conf_ok ev risk margin_ok:
    case False{} _ _ _:
      Advise{v, LowConfidence{}}
    case True{} None{} _ _:
      Advise{v, NoEvidence{}}
    case True{} Some{False{}} _ _:
      Advise{v, WeakEvidence{}}
    case True{} Some{True{}} None{} _:
      Advise{v, UnknownRisk{}}
    case True{} Some{True{}} Some{False{}} _:
      Advise{v, HighRisk{}}
    case True{} Some{True{}} Some{True{}} False{}:
      Advise{v, Ambiguous{}}
    case True{} Some{True{}} Some{True{}} True{}:
      Delegate{v}

# Stale evidence is decided before anything else is even looked at.
def Gate.decide(f: Freshness, p: Policy, j: Judgment) -> Decision:
  match f p j:
    case Stale{} _ _:
      Advise{Judgment.verdict(j), StaleEvidence{}}
    case Fresh{} Policy{mc, me, mr, mm} Judgment{+v, c, pa, pr, ph, e, r}:
      Gate.step(U32.is_ge(c, mc), Gate.at_least(e, me), Gate.at_most(r, mr), Judgment.margin_ok(v, pa, pr, ph, mm), v)

# Display
# =======

def Bp.pad(small: Bool, f: U32) -> String:
  match small:
    case True{}:
      "0" ++ U32.show(f)
    case False{}:
      U32.show(f)

# 900 -> "0.09", 10000 -> "1.00"
def Bp.show(+bp: U32) -> String:
  whole = (bp / 10000 : U32)
  +frac = ((bp % 10000 : U32) / 100 : U32)
  U32.show(whole) ++ "." ++ Bp.pad(U32.is_lt(frac, 10), frac)

def Bp.show_opt(label: String, m: Maybe<&2, U32>) -> String:
  match m:
    case None{}:
      ""
    case Some{x}:
      " " ++ label ++ "=" ++ Bp.show(x)

# The line stamped into the captain's `gate record --reason`.
def Judgment.stamp(j: Judgment) -> String:
  match j:
    case Judgment{v, c, pa, pr, ph, e, r}:
      "jev:" ++ Verdict.show(v) ++ " conf=" ++ Bp.show(c) ++ Bp.show_opt("evidence", e) ++ Bp.show_opt("risk", r)

def Decision.show(d: Decision) -> String:
  match d:
    case Delegate{v}:
      "delegate " ++ Verdict.show(v)
    case Advise{v, r}:
      "advise " ++ Verdict.show(v) ++ " (" ++ Reason.show(r) ++ ")"

def main() -> String:
  Decision.show(Gate.decide(Fresh{}, Policy.default(), Judgment{Hold{}, 900, 3200, 2800, 4000, Some{3200}, Some{6700}}))
