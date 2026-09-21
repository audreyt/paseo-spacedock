import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadyGate } from "../shared/contracts";
import { toJudgment, decideGate, type GateDecision } from "./gate";

const ENTITY_CAP = 12_000;
const ARTIFACT_CAP = 6_000;
const ARTIFACT_MAX = 3;

interface BriefingArtifact {
  uri: string;
  summary?: string;
  mediaType?: string;
}

interface Briefing {
  question?: string;
  artifacts?: BriefingArtifact[];
}

function sh(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 15_000 }, (error, stdout) => {
      resolve({
        code:
          typeof (error as { code?: number } | null)?.code === "number"
            ? (error as { code: number }).code
            : 0,
        stdout: String(stdout),
      });
    });
  });
}

function readEntity(workflowDir: string, slug: string): string | null {
  for (const candidate of [
    join(workflowDir, `${slug}.md`),
    join(workflowDir, slug, "index.md"),
  ]) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8").slice(0, ENTITY_CAP);
    }
  }
  return null;
}

function latestBriefing(
  workflowDir: string,
  slug: string,
  stage: string,
): Briefing | null {
  const dir = join(workflowDir, slug, "review", stage);
  if (!existsSync(dir)) return null;
  const rooms = readdirSync(dir)
    .filter((name) => /^briefing-\d+$/.test(name))
    .sort(
      (a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]),
    );
  const latest = rooms.at(-1);
  if (!latest) return null;
  try {
    return JSON.parse(
      readFileSync(join(dir, latest, "index.json"), "utf8"),
    ) as Briefing;
  } catch {
    return null;
  }
}

async function artifactText(
  workflowDir: string,
  uri: string,
): Promise<string | null> {
  const match = /^git-root:\/\/[^/]+\/([0-9a-f]{7,40})\/(.+)$/.exec(uri);
  if (!match) return null;
  const [, commit, path] = match;
  const root = await sh("git", ["rev-parse", "--show-toplevel"], workflowDir);
  const gitRoot = root.code === 0 ? root.stdout.trim() : workflowDir;
  const result = await sh("git", ["show", `${commit}:${path}`], gitRoot);
  if (result.code !== 0) return null;
  return result.stdout.slice(0, ARTIFACT_CAP);
}

function extractDigest(body: string | null): string | null {
  if (!body) return null;
  const re = /digest:\s*(sha256:[0-9a-f]{64})/g;
  let last: string | null = null;
  for (const m of body.matchAll(re)) {
    last = m[1];
  }
  return last;
}

export async function gatherGateState(
  workflowDir: string,
  gate: ReadyGate,
): Promise<Record<string, unknown>> {
  const slug = gate.slug || gate.id;
  const entityBody = readEntity(workflowDir, slug);
  const digest = extractDigest(entityBody);
  const briefing = latestBriefing(workflowDir, slug, gate.current);
  const artifacts = await Promise.all(
    (briefing?.artifacts ?? [])
      .slice(0, ARTIFACT_MAX)
      .map(async (a) => ({
        summary: a.summary ?? null,
        uri: a.uri,
        text: await artifactText(workflowDir, a.uri),
      })),
  );
  return {
    entity: {
      slug,
      status: gate.current,
      body: entityBody,
    },
    gate: {
      question: briefing?.question ?? null,
      stage: gate.current,
      readiness: gate.readiness,
      digest,
    },
    briefing: { artifacts },
  };
}

export interface JudgeResult {
  verdict: string;
  confidence: number;
  probabilities: Record<string, number>;
  evidence: number | null;
  risk: number | null;
  model: string;
  decision: GateDecision;
}

export async function judgeGate(
  state: Record<string, unknown>,
  apiKey: string | undefined,
  opts: { baseUrl?: string; model?: string; fresh?: boolean } = {},
): Promise<JudgeResult> {
  const baseUrl = (
    opts.baseUrl ||
    process.env.TYPESAFE_BASE_URL ||
    "https://api.typesafe.ai"
  ).replace(/\/+$/, "");
  const model =
    opts.model || process.env.TYPESAFE_DEFAULT_MODEL || "jev-latest";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      state,
      questions: {
        verdict: {
          type: "choice",
          instructions: {
            question:
              "How should this gate application be decided? Judge whether `gate.question` is satisfied for `entity` leaving `gate.stage`, using `briefing` evidence.",
          },
          criteria: {
            approve:
              "The briefing evidence answers the gate question; advancing is safe.",
            revise:
              "Evidence is missing, weak, or contradicted; send it back for another cycle.",
            hold: "Not decidable from this evidence; a human must look.",
          },
        },
        evidence_ok: {
          type: "noul",
          instructions:
            "Do the briefing artifacts actually support the claim that `gate.question` is answered?",
        },
        risk: {
          type: "score",
          instructions:
            "If this gate is wrongly approved, how costly is the mistake?",
          criteria: [
            "Routine and easily reversed",
            "Meaningful rework or confusion",
            "Serious damage or hard to reverse",
          ],
        },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const hint =
      response.status === 401 || response.status === 403
        ? " — set typesafeApiKey in plugin settings or TYPESAFE_API_KEY on the daemon"
        : "";
    throw new Error(`typesafe ${response.status}: ${body}${hint}`);
  }
  const body = (await response.json()) as {
    model: string;
    answers: Record<string, Record<string, unknown> | undefined>;
  };
  const verdict = body.answers?.verdict;
  const choice = verdict?.choice;
  if (typeof choice !== "string") {
    throw new Error("typesafe returned no valid verdict choice");
  }
  const probability = (answer: Record<string, unknown> | undefined) => {
    for (const key of ["noul", "score", "probability", "value"]) {
      const v = answer?.[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  };
  const result: Omit<JudgeResult, "decision"> = {
    verdict: choice,
    confidence:
      typeof verdict?.confidence === "number" ? verdict.confidence : 0,
    probabilities:
      verdict?.probabilities && typeof verdict.probabilities === "object"
        ? (verdict.probabilities as Record<string, number>)
        : {},
    evidence: probability(body.answers.evidence_ok),
    risk: probability(body.answers.risk),
    model: typeof body.model === "string" ? body.model : "jev-latest",
  };
  const judgment = toJudgment(result);
  return { ...result, decision: decideGate(judgment, opts.fresh ?? true) };
}
