import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { StageRunner } from "../engines/abstractions/interface/stage-runner.js";
import type { Messaging } from "../integrations/abstractions/interface/messaging.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { EligibilityJudge } from "../integrations/abstractions/interface/eligibility-judge.js";
import type { DecisionService } from "../decisions/decision-service.js";
import type { Run } from "../workflows/types/run.js";
import type { OperationalContext, OperationalStage } from "./types/context.js";
import type { OperationalScripts } from "./abstractions/interface/scripts.js";
import { OperationalApprovals } from "./approvals.js";
import { OperationalScriptManager } from "./script-manager.js";
import { OperationalDocumentation } from "./documentation.js";
import {
  OperationalPlanning,
  OperationalPlanApproval,
  OperationalWaiting,
} from "./stages/planning.js";
import {
  OperationalBuilding,
  OperationalTesting,
  OperationalReviewing,
} from "./stages/building.js";
import {
  OperationalExecutionApproval,
  OperationalExecuting,
  OperationalVerifying,
  OperationalCompleting,
  OperationalReconciling,
} from "./stages/execution.js";
import { Workflow } from "../workflows/workflow.js";
import { AssigneePolicy } from "../features/assignee-policy.js";
import { Workspace } from "../development/workspace.js";
import type { AnalysisWorkspace } from "../development/abstractions/interface/analysis-workspace.js";
import { OperationalIdentity } from "./plan-identity.js";
export class OperationalProcessor {
  private readonly stages: ReadonlyMap<string, OperationalStage>;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    executor: StageRunner,
    slack: Messaging,
    decisions: DecisionService,
    private readonly jira: IssueTracker | undefined,
    judge: EligibilityJudge | undefined,
    directory: string,
    scripts?: OperationalScripts,
    workspace: AnalysisWorkspace = new Workspace(directory),
  ) {
    const owner = String(config.slack.user ?? "");
    const approvals = new OperationalApprovals(store, decisions, owner);
    const context: OperationalContext = {
      store,
      config,
      executor,
      slack,
      decisions,
      jira: jira!,
      judge,
      approvals,
      scripts: scripts ?? new OperationalScriptManager(directory, approvals),
      documentation: new OperationalDocumentation(store, jira!, slack, owner),
      workspace,
    };
    this.stages = new Map<string, OperationalStage>([
      ["investigating", new OperationalPlanning(context)],
      ["waiting", new OperationalWaiting(context)],
      ["planApproval", new OperationalPlanApproval(context)],
      ["building", new OperationalBuilding(context)],
      ["testing", new OperationalTesting(context)],
      ["review", new OperationalReviewing(context)],
      ["executionApproval", new OperationalExecutionApproval(context)],
      ["executing", new OperationalExecuting(context)],
      ["verifying", new OperationalVerifying(context)],
      ["documenting", new OperationalCompleting(context)],
      ["reconciliation", new OperationalReconciling(context)],
    ]);
  }
  async process(run: Run, signal: AbortSignal): Promise<void> {
    if (!this.jira || !this.config.slack.user)
      throw new Error(
        "Jira and authenticated owner are required for Operational Tasks",
      );
    const issue = await this.jira.issue(String(run.data.issueKey));
    new AssigneePolicy(this.config.jira?.accountId).assert(issue);
    if (issue.fields.issuetype.name !== "Ticket")
      throw new Error(
        "Operational Tasks only accepts verified owner-assigned Tickets",
      );
    if (
      (issue.fields.labels ?? []).some(
        (label: string) => label.toLowerCase() === "no-auto",
      )
    )
      throw new Error("Operational Ticket opted out of automation");
    if (run.state === "queued") {
      run.data.operationalSourceDigest = new OperationalIdentity().hash({
        key: issue.key,
        summary: issue.fields.summary,
        description: issue.fields.description,
        assignee: issue.fields.assignee?.accountId,
      });
      this.store.save(run);
      new Workflow(this.store).transition(run, "START");
      return;
    }
    const sourceDigest = new OperationalIdentity().hash({
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description,
      assignee: issue.fields.assignee?.accountId,
    });
    if (
      run.data.operationalSourceDigest &&
      run.data.operationalSourceDigest !== sourceDigest &&
      run.state !== "reconciliation"
    ) {
      run.data.operationalScopeChanged = true;
      run.data.operationalObservedSourceDigest = sourceDigest;
      this.store.save(run);
      new Workflow(this.store).transition(run, "SCOPE_CHANGED");
      return;
    }
    const stage = this.stages.get(run.state);
    if (!stage) throw new Error("Unsupported operational state: " + run.state);
    await stage.run(run, signal);
  }
}
