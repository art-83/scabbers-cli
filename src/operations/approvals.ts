import type { Store } from "../storage/store.js";
import type { DecisionService } from "../decisions/decision-service.js";
import type { Run } from "../workflows/types/run.js";
import { OperationalApprovalProof } from "./approval-proof.js";
import type { OperationalPlan } from "./types/operation.js";
export class OperationalApprovals {
  constructor(
    private readonly store: Store,
    private readonly decisions: DecisionService,
    private readonly owner: string,
  ) {}
  private proof(): OperationalApprovalProof {
    return new OperationalApprovalProof(this.store, this.owner);
  }
  digest(run: Run, kind: "plan" | "execute"): string {
    return this.proof().digest(run, kind);
  }
  question(run: Run, kind: "plan" | "execute"): string {
    return this.proof().question(run, kind);
  }
  option(kind: "plan" | "execute"): string {
    return this.proof().option(kind);
  }
  async request(run: Run, kind: "plan" | "execute"): Promise<void> {
    const plan = run.data.operationalPlan as OperationalPlan;
    for (const pending of this.decisions.list()) {
      if (
        pending.runId === run.id &&
        pending.status === "pending" &&
        pending.question !== this.question(run, kind)
      )
        this.store.db
          .prepare(
            "UPDATE decisions SET status='superseded' WHERE id=? AND status='pending'",
          )
          .run(pending.id);
    }
    const canExecute =
      kind === "plan" ||
      (plan.mode === "script" &&
        (run.data.jev as { classification?: string } | undefined)
          ?.classification === "A-candidate");
    const decision = await this.decisions.ask(
      run.id,
      this.question(run, kind),
      [
        ...(canExecute ? [this.option(kind)] : []),
        "Solicitar ajustes",
        "Executar manualmente",
      ],
      Date.now(),
      undefined,
      {
        summary: plan.summary.slice(0, 1200),
        problem: `${plan.environment}: ${plan.targets.join("; ")}`.slice(
          0,
          1200,
        ),
        whyHuman:
          kind === "plan"
            ? "Validar o plano antes de criar sua implementação. Nenhuma ação operacional é autorizada nesta primeira etapa."
            : canExecute
              ? "Revisar a implementação, testes e riscos e autorizar explicitamente esta operação. Silêncio, Retomar ou aprovação do plano não autorizam execução."
              : "A documentação está pronta para revisão, mas o plano é manual ou não foi elegível pelo JEV para automação. Não há opção de executar automaticamente.",
      },
    );
    this.store.setSetting(`operational-approval:${decision.id}`, {
      runId: run.id,
      kind,
      digest: this.digest(run, kind),
      version: decision.version,
    });
    run.data[kind === "plan" ? "planDecisionId" : "executionDecisionId"] =
      decision.id;
    this.store.save(run);
  }
  answer(run: Run, kind: "plan" | "execute"): string | undefined {
    return this.proof().answer(run, kind);
  }
  assertExecution(run: Run): void {
    this.proof().assertExecution(run);
  }
}
