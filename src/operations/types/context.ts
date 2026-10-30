import type { Store } from "../../storage/store.js";
import type { Config } from "../../config/types/config.js";
import type { StageRunner } from "../../engines/abstractions/interface/stage-runner.js";
import type { DecisionService } from "../../decisions/decision-service.js";
import type { IssueTracker } from "../../integrations/abstractions/interface/issue-tracker.js";
import type { Messaging } from "../../integrations/abstractions/interface/messaging.js";
import type { EligibilityJudge } from "../../integrations/abstractions/interface/eligibility-judge.js";
import type { OperationalScripts } from "../abstractions/interface/scripts.js";
import type { OperationalApprovals } from "../approvals.js";
import type { OperationalDocumentation } from "../documentation.js";
import type { Run } from "../../workflows/types/run.js";
import type { AnalysisWorkspace } from "../../development/abstractions/interface/analysis-workspace.js";
export type OperationalContext = {
  store: Store;
  config: Config;
  executor: StageRunner;
  decisions: DecisionService;
  jira: IssueTracker;
  slack: Messaging;
  judge: EligibilityJudge | undefined;
  scripts: OperationalScripts;
  approvals: OperationalApprovals;
  documentation: OperationalDocumentation;
  workspace: AnalysisWorkspace;
};
export interface OperationalStage {
  run(run: Run, signal: AbortSignal): Promise<void>;
}
