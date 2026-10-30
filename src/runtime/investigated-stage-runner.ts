import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import { InvestigationJournal } from "./investigation-journal.js";
import { InvestigationInputs } from "./investigation-inputs.js";

export class InvestigatedStageRunner implements StageRunner {
  private readonly journal: InvestigationJournal;
  constructor(
    store: Store,
    private readonly delegate: StageRunner,
    jira?: IssueTracker,
  ) {
    this.journal = new InvestigationJournal(store, jira);
  }
  async execute(
    run: Run,
    instruction: string,
    skill: string,
    mode: "read" | "edit" | "browser",
    cwd: string,
    signal: AbortSignal,
    fresh = false,
  ) {
    if (mode !== "read")
      return this.delegate.execute(
        run,
        instruction,
        skill,
        mode,
        cwd,
        signal,
        fresh,
      );
    const fingerprint = this.journal.fingerprint({
      state: run.state,
      instruction,
      skill,
      cwd,
      fresh,
      member: (run.data.featureMember as { key?: string } | undefined)?.key,
      source: run.data.operationalSourceDigest,
      requirements: new InvestigationInputs().read(run),
      featureAnswers: run.data.featureDecisionAnswers,
      family: (run.data.family as { digest?: string } | undefined)?.digest,
      revisions: run.data.analysisRevisions,
      answer: run.data.humanAnswer,
      plan: run.data.operationalPlan,
      implementation: run.data.operationalImplementation,
      repair:
        run.data.operationalRepair ??
        run.data.memberRepair ??
        run.data.planRepair,
    });
    const pending = this.journal.pending(run, fingerprint);
    const record =
      pending ??
      this.journal.record(
        run,
        fingerprint,
        skill,
        await this.delegate.execute(
          run,
          instruction,
          skill,
          mode,
          cwd,
          signal,
          fresh,
        ),
      );
    await this.journal.publish(run, record);
    this.journal.consumed(run, record);
    return record.result;
  }
}
