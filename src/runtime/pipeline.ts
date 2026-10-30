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
    this.support = new SupportProcessor(
      store,
      config,
      executor,
      slack,
      decisions,
      jira,
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
      if (
        decision.question.startsWith("Authorize staging browser") &&
        decision.answer === "Authorize staging browser"
      )
        run.data.browserAuthorized = true;
      this.store.save(run);
    }
    if (run.state === "waiting") {
      if (!decision) return;
      this.workflow.transition(run, "ANSWER");
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
