import type { Store } from "../storage/store.js";

import type { Run } from "../workflows/types/run.js";
import { OperationalIdentity } from "./plan-identity.js";
import { operationalReviewSchema } from "./implementation-schema.js";
import type {
  OperationalPlan,
  OperationalImplementation,
} from "./types/operation.js";
export class OperationalApprovalProof {
  constructor(
    private readonly store: Store,
    private readonly owner: string,
  ) {}
  digest(run: Run, kind: "plan" | "execute"): string {
    const plan = run.data.operationalPlan as OperationalPlan;
    return kind === "plan"
      ? new OperationalIdentity().hash({
          plan: new OperationalIdentity().plan(plan),
          source: run.data.operationalSourceDigest,
        })
      : new OperationalIdentity().hash({
          source: run.data.operationalSourceDigest,
          implementation: new OperationalIdentity().implementation(
            plan,
            run.data.operationalImplementation as OperationalImplementation,
          ),
          tests: run.data.operationalTests,
          review: run.data.operationalReview,
          reviewSession: run.data.reviewSession,
        });
  }
  question(run: Run, kind: "plan" | "execute"): string {
    return `${kind === "plan" ? "Aprovar a criação da implementação deste plano operacional" : "Aprovar a execução desta implementação operacional exata"}?\nVersão: ${this.digest(run, kind)}\nCard: ${run.data.issueKey}. ${kind === "plan" ? "Plano de criação, alvos, riscos e estratégia de testes estão no card; a implementação ainda será preparada." : "Plano aprovado, arquivos completos, resultados dos testes, revisão independente, alvos e riscos estão documentados no card."} ${kind === "plan" ? "Esta aprovação permite somente preparar e testar localmente; não autoriza operar produção." : "Esta aprovação permite os scripts revisados de pré-condição, execução e verificação, no ambiente e alvos indicados. Não autoriza outra versão nem rollback automático."}`;
  }
  option(kind: "plan" | "execute"): string {
    return kind === "plan"
      ? "Aprovar criação deste plano"
      : "Aprovar execução desta implementação";
  }
  answer(run: Run, kind: "plan" | "execute"): string | undefined {
    const id =
      run.data[kind === "plan" ? "planDecisionId" : "executionDecisionId"];
    if (typeof id !== "string") return undefined;
    const decision = this.store.db
      .prepare("SELECT * FROM decisions WHERE id=?")
      .get(id);
    const receipt = this.store.getSetting(`operational-approval:${id}`) as
      | { runId: string; kind: string; digest: string; version: number }
      | undefined;
    if (
      !decision ||
      decision.runId !== run.id ||
      decision.userId !== this.owner ||
      decision.status !== "answered" ||
      decision.question !== this.question(run, kind) ||
      !receipt ||
      receipt.runId !== run.id ||
      receipt.kind !== kind ||
      receipt.version !== decision.version ||
      receipt.digest !== this.digest(run, kind)
    )
      return undefined;
    return typeof decision.answer === "string" ? decision.answer : undefined;
  }
  assertExecution(run: Run): void {
    const current = this.store.get(run.id);
    if (
      current.paused ||
      current.state === "cancelled" ||
      current.state !== run.state ||
      this.digest(current, "execute") !== this.digest(run, "execute")
    )
      throw new Error(
        "Operational approval no longer matches the active unpaused checkpoint",
      );
    const review = operationalReviewSchema.parse(run.data.operationalReview);
    const tests = run.data.operationalTests as
      | {
          passed?: boolean;
          code?: number;
          truncated?: boolean;
          implementationDigest?: string;
        }
      | undefined;
    if (
      run.data.operationalReviewDigest !==
        new OperationalIdentity().implementation(
          run.data.operationalPlan as OperationalPlan,
          run.data.operationalImplementation as OperationalImplementation,
        ) ||
      tests?.implementationDigest !== run.data.operationalReviewDigest ||
      !review.approved ||
      !review.scopeMatchesPlan ||
      !review.testsMeaningful ||
      !review.verificationMeaningful ||
      !review.credentialFree ||
      !review.checksReadOnly ||
      review.findings.length > 0 ||
      !run.data.reviewSession ||
      run.data.reviewSession === run.sessionId ||
      !tests?.passed ||
      tests.code !== 0 ||
      tests.truncated === true ||
      (run.data.operationalPlan as OperationalPlan).mode !== "script" ||
      (run.data.jev as { classification?: string } | undefined)
        ?.classification !== "A-candidate" ||
      this.answer(run, "plan") !== this.option("plan") ||
      this.answer(run, "execute") !== this.option("execute")
    )
      throw new Error(
        "Both explicit owner approvals for this exact eligible operational plan and implementation are required",
      );
  }
}
