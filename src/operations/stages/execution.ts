import type { OperationalContext, OperationalStage } from "../types/context.js";
import type { Run } from "../../workflows/types/run.js";
import { Workflow } from "../../workflows/workflow.js";
import { OperationalIdentity } from "../plan-identity.js";
import type {
  OperationalPlan,
  OperationalImplementation,
} from "../types/operation.js";

export class OperationalExecutionApproval implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run): Promise<void> {
    const { store, approvals } = this.context,
      answer = approvals.answer(run, "execute"),
      workflow = new Workflow(store);
    const implementationDigest = new OperationalIdentity().implementation(
      run.data.operationalPlan as OperationalPlan,
      run.data.operationalImplementation as OperationalImplementation,
    );
    if (
      run.data.operationalReviewDigest !== implementationDigest ||
      (
        run.data.operationalTests as
          { implementationDigest?: string } | undefined
      )?.implementationDigest !== implementationDigest
    ) {
      delete run.data.executionDecisionId;
      store.save(run);
      workflow.transition(run, "REVISE");
      return;
    }
    if (answer === approvals.option("execute")) {
      approvals.assertExecution(run);
      workflow.transition(run, "EXECUTION_APPROVED");
      return;
    }
    if (answer === "Executar manualmente") {
      run.data.operationalManual = true;
      store.save(run);
      workflow.transition(run, "MANUAL");
      return;
    }
    if (answer === "Solicitar ajustes") {
      run.data.previousOperationalImplementation =
        run.data.operationalImplementation;
      delete run.data.executionDecisionId;
      delete run.data.operationalReview;
      run.data.operationalBuildAttempts = 0;
      store.save(run);
      workflow.transition(run, "REVISE");
      return;
    }
    await approvals.request(run, "execute");
  }
}
export class OperationalExecuting implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { store, approvals } = this.context,
      workflow = new Workflow(store);
    approvals.assertExecution(run);
    if (run.data.operationalExecution) {
      workflow.transition(run, "UNCERTAIN");
      return;
    }
    const digest = approvals.digest(run, "execute");
    run.data.operationalExecution = {
      status: "started",
      digest,
      at: Date.now(),
    };
    store.save(run);
    await this.context.jira.comment(
      run.id,
      String(run.data.issueKey),
      "Operational Tasks — início de operação após as duas aprovações explícitas. Versão: " +
        digest +
        ". Não repetir automaticamente se o resultado ficar incerto.",
      "operational-execution-started:" + digest,
    );
    try {
      const result = await this.context.scripts.execute(run, signal);
      run.data.operationalExecution = {
        status: result.code === 0 ? "completed" : "failed",
        digest,
        at: Date.now(),
        ...result,
      };
      store.save(run);
      workflow.transition(run, result.code === 0 ? "EXECUTED" : "UNCERTAIN");
    } catch (error) {
      run.data.operationalExecution = {
        status: "uncertain",
        digest,
        at: Date.now(),
        error: error instanceof Error ? error.message : "Execution interrupted",
      };
      store.save(run);
      if (signal.aborted) throw error;
      workflow.transition(run, "UNCERTAIN");
    }
  }
}
export class OperationalVerifying implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { store } = this.context;
    try {
      const result = await this.context.scripts.verify(run, signal);
      run.data.operationalVerification = { passed: true, ...result };
      store.save(run);
      new Workflow(store).transition(run, "VERIFIED");
    } catch (error) {
      run.data.operationalVerification = {
        passed: false,
        error:
          error instanceof Error ? error.message : "Verification interrupted",
      };
      store.save(run);
      if (signal.aborted) throw error;
      new Workflow(store).transition(run, "UNCERTAIN");
    }
  }
}
export class OperationalCompleting implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run): Promise<void> {
    await this.context.documentation.complete(
      run,
      run.data.operationalManual === true,
    );
    run.data.operationalDocumented = true;
    this.context.store.save(run);
    new Workflow(this.context.store).transition(run, "DOCUMENTED");
  }
}
export class OperationalReconciling implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run): Promise<void> {
    const { store } = this.context;
    const question = run.data.operationalScopeChanged
      ? "Os requisitos do Ticket mudaram depois da preparação. As aprovações antigas não autorizam esta nova versão. Deseja reavaliar o plano sem executar nada?"
      : "A operação falhou, foi interrompida ou não confirmou o resultado. Não será repetida automaticamente. Revise a evidência no card antes de escolher uma nova preparação.";
    const decision = this.context.decisions
      .list()
      .find(
        (d) =>
          d.runId === run.id &&
          d.userId === run.data.ownerSlackUser &&
          d.question === question &&
          d.status === "answered",
      );
    if (decision?.answer === "Reavaliar plano sem repetir a operação") {
      const history = (run.data.operationalHistory ?? []) as unknown[];
      history.push({
        plan: run.data.operationalPlan,
        implementation: run.data.operationalImplementation,
        execution: run.data.operationalExecution,
        verification: run.data.operationalVerification,
      });
      run.data.operationalHistory = history;
      for (const key of [
        "planDecisionId",
        "executionDecisionId",
        "operationalPlan",
        "operationalImplementation",
        "operationalArtifacts",
        "operationalReview",
        "operationalTests",
        "operationalExecution",
        "operationalVerification",
        "jev",
      ])
        delete run.data[key];
      run.data.operationalBuildAttempts = 0;
      if (run.data.operationalObservedSourceDigest)
        run.data.operationalSourceDigest =
          run.data.operationalObservedSourceDigest;
      delete run.data.operationalScopeChanged;
      delete run.data.operationalObservedSourceDigest;
      store.save(run);
      new Workflow(store).transition(run, "REPLAN");
      return;
    }
    if (decision?.answer === "Encaminhar para atendimento manual") {
      new Workflow(store).transition(run, "MANUAL");
      return;
    }
    await this.context.jira.comment(
      run.id,
      String(run.data.issueKey),
      "Operational Tasks — resultado não confirmado. Nenhuma repetição ou rollback automático autorizado.\n" +
        JSON.stringify(
          {
            execution: run.data.operationalExecution,
            verification: run.data.operationalVerification,
          },
          null,
          2,
        ),
      "operational-uncertain:" +
        new OperationalIdentity().hash(run.data.operationalExecution),
    );
    await this.context.decisions.ask(
      run.id,
      question,
      [
        "Reavaliar plano sem repetir a operação",
        "Encaminhar para atendimento manual",
      ],
      Date.now(),
      undefined,
      {
        summary:
          "Uma operação revisada foi iniciada, mas o resultado não foi confirmado.",
        problem:
          "É necessário reconciliar a execução real antes de qualquer nova tentativa.",
        whyHuman:
          "Retomar não repete a operação. Uma nova preparação exigirá novas aprovações; rollback também precisa de revisão e autorização próprias.",
      },
    );
  }
}
