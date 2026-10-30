import { Workspace } from "../development/workspace.js";
import { OperationalProcessor } from "../operations/processor.js";
import { SupportProcessor } from "../support/support-processor.js";
import { DevelopmentProcessor } from "../development/development-processor.js";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { Run } from "../workflows/types/run.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { EligibilityJudge } from "../integrations/abstractions/interface/eligibility-judge.js";
import type { DecisionService } from "../decisions/decision-service.js";
import { Workflow } from "../workflows/workflow.js";
export class Pipeline {
  private readonly workflow: Workflow;
  private readonly support: SupportProcessor;
  private readonly development: DevelopmentProcessor;
  private readonly operational: OperationalProcessor;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    executor: StageRunner,
    slack: Messaging,
    private readonly decisions: DecisionService,
    jira: IssueTracker | undefined,
    jev: EligibilityJudge | undefined,
    directory: string,
  ) {
    this.workflow = new Workflow(store);
    this.operational = new OperationalProcessor(
      store,
      config,
      executor,
      slack,
      decisions,
      jira,
      jev,
      directory,
    );
    this.support = new SupportProcessor(
      store,
      config,
      executor,
      slack,
      decisions,
      jira,
      new Workspace(directory),
    );
    this.development = new DevelopmentProcessor(
      store,
      config,
      executor,
      decisions,
      jira,
      jev,
      directory,
    );
  }
  async step(run: Run, signal: AbortSignal): Promise<void> {
    if (!this.config.remoteEnabled) return;
    const decision = this.decisions
      .list()
      .filter((d) => d.runId === run.id && d.status === "answered")
      .at(-1);
    if (decision && run.data.lastDecision !== decision.id) {
      run.data.humanAnswer = {
        question: decision.question,
        answer: decision.answer,
      };
      run.data.lastDecision = decision.id;
      this.store.log(run.id, "Authenticated owner decision received");
      this.store.save(run);
    }
    if (run.kind === "operational")
      return this.operational.process(run, signal);
    if (run.state === "waiting") {
      if (!decision) return;
      if (run.data.resumeStage && decision.answer === "Pause") {
        run.paused = 1;
        this.store.db
          .prepare("UPDATE runs SET paused=1 WHERE id=?")
          .run(run.id);
        this.store.save(run);
        return;
      }
      if (run.kind !== "support" && run.data.resumeStage === "e2e") {
        if (decision.answer !== "Ready: validate access again")
          throw new Error("Browser retry requires its current access decision");
        delete run.data.resumeStage;
        this.workflow.transition(run, "RETRY_E2E");
      } else if (run.kind !== "support" && run.data.resumeStage === "fixing") {
        if (
          !["Revise attempt", "Needs changes"].includes(decision.answer ?? "")
        )
          throw new Error(
            "A new delivery attempt requires its explicit revision decision",
          );
        const attempts = (run.data.previousAttempts ?? []) as unknown[];
        attempts.push({
          attempt: run.data.deliveryAttempt ?? 0,
          review: run.data.review,
          publications: run.data.publications,
          e2e: run.data.e2e,
          finalTestDigest: run.data.finalTestDigest,
        });
        run.data.previousAttempts = attempts;
        run.data.deliveryAttempt = Number(run.data.deliveryAttempt ?? 0) + 1;
        for (const key of [
          "resumeStage",
          "reviewStarted",
          "reviewSession",
          "review",
          "reviewBrief",
          "publicationApproval",
          "publicationPreview",
          "publicationProgress",
          "publications",
          "readiness",
          "finalTestDigest",
          "finalTests",
          "e2e",
          "familyVerification",
          "scopeVerified",
        ])
          delete run.data[key];
        this.workflow.transition(run, "REVISE");
      } else this.workflow.transition(run, "ANSWER");
      return;
    }
    if (run.kind === "support") {
      if (run.state === "queued") {
        this.workflow.transition(run, "START");
        return;
      }
      return this.support.process(run, signal);
    }
    return this.development.processRun(run, signal);
  }
}
