import Base
import ./gate.bend as G

# Export manifest: the JS emitter keeps only what `main` reaches, so this touches
# every def the host calls. Never run for its value; scripts/bend-build.mjs
# strips this program's CLI footer and re-exports the compiled defs.

def show_read(m: Maybe<&2, G.Verdict>) -> String:
  match m:
    case None{}:
      "none"
    case Some{v}:
      G.Verdict.show(v)

def main() -> String:
  +j = {G.Judgment{G.Hold{}, 900, 3200, 2800, 4000, Some{3200}, Some{6700}} : G.Judgment}
  +d = G.Gate.decide(G.Fresh{}, G.Policy.default(), j)
  String.concat([G.Decision.show(d), G.Reason.show(G.Ambiguous{}), G.Bp.show(900), show_read(G.Verdict.read("hold")), G.Judgment.stamp(j), G.Decision.show(d)])
