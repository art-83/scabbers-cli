import type { EligibilityJudge } from "../abstractions/interface/eligibility-judge.js";
import { readFileSync } from "node:fs";
import type { EligibilityForm } from "./types/eligibility-form.js";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../assets/eligibility-form.json", import.meta.url),
    "utf8",
  ),
);
const probability = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
function scanSecrets(text: string): string {
  const patterns = [
    /xox[baprs]-[\w-]+/,
    /AKIA[A-Z0-9]{16}/,
    /BEGIN .*PRIVATE KEY/,
    /eyJ[\w-]+\.[\w-]+\.[\w-]+/,
    /bearer\s+[\w.-]{20,}/i,
    /[a-z+]+:\/\/[^\s:/@]+:[^\s@]+@/i,
    /(?:password|passwd|senha|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{6}/i,
  ];
  if (patterns.some((pattern) => pattern.test(text)))
    throw new Error("Possible credential in JEV evidence");
  return text;
}
function clean(text: string): string {
  return scanSecrets(text)
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b[A-Z][A-Z0-9]+-\d+\b|\b\d{5,}\b|R\$\s*[\d.,]+/gi,
      "[redacted]",
    )
    .slice(0, 600);
}
export class JevClient implements EligibilityJudge {
  constructor(
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async classify(
    form: EligibilityForm,
    blockedNames: string[],
  ): Promise<{
    classification: "A-candidate" | "B" | "C";
    score: number;
    rubric: string;
    answers: unknown[];
  }> {
    const text = (value: string) => {
      const cleaned = clean(value);
      if (
        blockedNames.some(
          (n) =>
            n.trim() &&
            cleaned.toLocaleLowerCase().includes(n.toLocaleLowerCase()),
        )
      )
        throw new Error("Identifying name in JEV evidence");
      return cleaned;
    };
    const evidence = [
      ...form.evidence.map((e) => ({
        id: "",
        kind: e.kind,
        excerpt: text(e.excerpt),
      })),
      ...form.code.map((e) => ({
        id: "",
        kind: "code",
        excerpt: scanSecrets(e.excerpt),
        repository: text(e.repository),
        path: text(e.path) + ":" + e.line,
      })),
    ].map((e, i) => ({ ...e, id: `e${i + 1}` }));
    const state = {
      expected: text(form.nature.expected),
      observed: text(form.nature.observed),
      component: text(form.component),
      environment: text(form.environment),
      facts: [
        text(form.nature.trigger),
        `Root cause status: ${form.root_cause.status}`,
        `Reproduction: ${form.reproduction.result}`,
        ...form.risks.map(text),
      ],
      hypotheses:
        form.root_cause.status === "hypothesis"
          ? [text(form.root_cause.claim)]
          : [],
      gaps: form.open_decisions.map((d) => text(d.question)),
      evidence,
      assertions: [
        {
          id: "a1",
          claim: text(form.root_cause.claim),
          evidence_ids: evidence.map((e) => e.id),
        },
        {
          id: "a2",
          claim: text(form.proposed_fix.summary),
          evidence_ids: evidence
            .filter((e) => e.kind === "code")
            .map((e) => e.id),
        },
        {
          id: "a3",
          claim: text(form.proposed_fix.failing_test),
          evidence_ids: evidence
            .filter((e) => e.kind === "code")
            .map((e) => e.id),
        },
      ],
    };
    const answers: any[] = [];
    for (const reverse of [false, true]) {
      const questions = Object.fromEntries(
        Object.entries(spec.jev.questions).map(([id, raw]) => {
          const q = raw as any;
          return [
            id,
            {
              type: q.type,
              instructions: spec.jev.data_rule + q.instructions,
              criteria:
                reverse && q.type === "choice"
                  ? Object.fromEntries(Object.entries(q.criteria).reverse())
                  : q.criteria,
            },
          ];
        }),
      );
      const body = JSON.stringify({ state, model: "jev-1.13.0", questions });
      if (Buffer.byteLength(body) > 24_000)
        throw new Error("JEV request budget exceeded");
      const response = await this.transport(
        "https://api.typesafe.ai/v1/systemone",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + this.key,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(
          `JEV unavailable (HTTP ${response.status}); no eligibility granted`,
        );
      const raw = (await response.json()) as any;
      if (
        !/^jev-(latest|preview|\d+(?:\.\d+){0,2})$/.test(raw.model) ||
        !raw.answers ||
        Object.keys(raw.answers).sort().join() !==
          Object.keys(questions).sort().join() ||
        !Number.isInteger(raw.usage?.input_tokens) ||
        raw.usage.input_tokens < 0 ||
        !Number.isInteger(raw.usage?.output_tokens) ||
        raw.usage.output_tokens < 0
      )
        throw new Error("Invalid JEV response");
      for (const [id, q] of Object.entries(questions)) {
        const answer = raw.answers[id];
        if (answer?.type !== q.type) throw new Error("Invalid JEV answer type");
        if (q.type === "noul") {
          if (!probability(answer.noul)) throw new Error("Invalid JEV noul");
        } else {
          const ps = answer.probabilities;
          if (
            !ps ||
            Object.keys(ps).sort().join() !==
              Object.keys(q.criteria).sort().join() ||
            !Object.values(ps).every(probability) ||
            Math.abs(
              (Object.values(ps) as number[]).reduce((a, b) => a + b, 0) - 1,
            ) > 0.00001 ||
            !probability(answer.confidence) ||
            !(answer.choice in ps) ||
            ps[answer.choice] < Math.max(...(Object.values(ps) as number[]))
          )
            throw new Error("Invalid JEV probabilities");
        }
      }
      answers.push(raw.answers);
    }
    const score =
      Math.round(
        (1000 *
          answers.reduce(
            (sum, a) =>
              sum +
              a.autonomous_track.probabilities.eligible +
              a.autonomous_track.probabilities.eligible_with_decision,
            0,
          )) /
          2,
      ) / 1000;
    const gates =
      !["Bug", "Bug Crítico"].includes(form.issueType) ||
      form.labels.some((label) => label.toLowerCase() === "no-auto") ||
      (form.requires_outside_code.needed &&
        form.requires_outside_code.action === "change");
    return {
      classification: gates
        ? "C"
        : score >= spec.classifier.a_candidate_min_score
          ? "A-candidate"
          : "B",
      score,
      rubric: spec.classifier.rubric_version,
      answers,
    };
  }
}
