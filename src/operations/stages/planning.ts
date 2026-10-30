import type { OperationalContext, OperationalStage } from "../types/context.js";
import type { Run } from "../../workflows/types/run.js";
import { OperationalResult } from "../result.js";
import { operationalPlanSchema } from "../plan-schema.js";
import { OperationalIdentity } from "../plan-identity.js";
import { Workflow } from "../../workflows/workflow.js";
import { privateNames } from "../../integrations/jira/private-names.js";
export class OperationalPlanning implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run, signal: AbortSignal): Promise<void> {
    const { store, jira } = this.context;
    run.data.issue = await jira.evidence(String(run.data.issueKey));
    if (
      !run.data.analysisWorkspaces &&
      this.context.config.repositories.length
    ) {
      const paths = await this.context.workspace.prepareAnalysis(
        run.id,
        this.context.config.repositories,
        signal,
      );
      run.data.analysisWorkspaces = paths;
      run.data.analysisRevisions = await this.context.workspace.revisions(
        paths,
        signal,
      );
    }
    store.save(run);
    const plan = run.data.operationalPlan
      ? operationalPlanSchema.parse(run.data.operationalPlan)
      : await new OperationalResult(this.context).read(
          run,
          "Prepare only an operational creation plan for this owner-assigned Ticket. Do not create scripts or execute operations yet. Separate known facts from hypotheses and unknowns. Identify exact targets, preconditions, risks, unit-test strategy, success checks and manual rollback. The first approval permits creation only; a second approval of reviewed artifacts is mandatory before preflight, mutation or verification scripts. Use mode manual when essential mutation parameters, account identity, capabilities or targets are unverified. Never invent AWS account IDs or write parameters. Remote automation supports only explicitly known AWS account/profile/region targets; unsupported systems remain manual documentation. Do not ask to copy accessible evidence. Production diagnostic log reads are allowed only through the configured read-only tool.",
          operationalPlanSchema,
          signal,
        );
    if (!plan) return;
    if (plan.issueKey !== run.data.issueKey)
      throw new Error("Operational plan changed the selected Ticket identity");
    new OperationalIdentity().assertCredentialFree(plan);
    run.data.operationalPlan = plan;
    run.data.identifyingNames = privateNames(
      run.data
        .issue as import("../../integrations/types/jira-issue.js").JiraIssue,
    );
    store.save(run);
    await this.context.documentation.plan(run);
    if (!this.context.judge?.classifyOperational)
      throw new Error(
        "Operational-specific JEV evaluator is unavailable; no execution eligibility granted",
      );
    run.data.jev = await this.context.judge.classifyOperational(
      plan,
      run.data.identifyingNames as string[],
    );
    store.save(run);
    new Workflow(store).transition(run, "PLAN");
  }
}
export class OperationalPlanApproval implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run): Promise<void> {
    const { approvals, store } = this.context,
      answer = approvals.answer(run, "plan");
    const workflow = new Workflow(store);
    if (answer === approvals.option("plan")) {
      workflow.transition(run, "PLAN_APPROVED");
      return;
    }
    if (answer === "Executar manualmente") {
      workflow.transition(run, "MANUAL");
      return;
    }
    if (answer === "Solicitar ajustes") {
      run.data.previousOperationalPlan = run.data.operationalPlan;
      delete run.data.planDecisionId;
      delete run.data.operationalPlan;
      delete run.data.jev;
      store.save(run);
      workflow.transition(run, "REVISE");
      return;
    }
    await approvals.request(run, "plan");
  }
}
export class OperationalWaiting implements OperationalStage {
  constructor(private readonly context: OperationalContext) {}
  async run(run: Run): Promise<void> {
    const decision = this.context.decisions
      .list()
      .find(
        (d) =>
          d.id === run.data.operationalQuestionId &&
          d.runId === run.id &&
          d.userId === run.data.ownerSlackUser &&
          d.status === "answered",
      );
    if (!decision) return;
    run.data.humanAnswer = {
      question: decision.question,
      answer: decision.answer,
    };
    delete run.data.operationalQuestionId;
    this.context.store.save(run);
    new Workflow(this.context.store).transition(run, "ANSWER");
  }
}
