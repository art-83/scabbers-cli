import type { JiraIssue } from "../../types/jira-issue.js";
import type { RoutingPlan } from "../../types/routing-plan.js";
export interface IssueTracker {
  issue(key: string): Promise<JiraIssue>;
  evidence(key: string): Promise<JiraIssue>;
  route(runId: string, reportKey: string, plan: RoutingPlan): Promise<string>;
  comment(
    runId: string,
    key: string,
    text: string,
    checkpoint?: string,
  ): Promise<string>;
  transition(
    runId: string,
    key: string,
    target: string,
    checkpoint: string,
  ): Promise<void>;
}
