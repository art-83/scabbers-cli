import type { JiraSearchPage } from "../../types/jira-search-page.js";
import type { JiraBoard } from "../../types/jira-board.js";
import type { JiraIssue } from "../../types/jira-issue.js";
import type { RoutingPlan } from "../../types/routing-plan.js";
export interface IssueTracker {
  markdownComment?(
    runId: string,
    key: string,
    text: string,
    checkpoint?: string,
  ): Promise<string>;
  readyForReview?(
    runId: string,
    key: string,
    checkpoint: string,
  ): Promise<boolean>;
  searchPage?(jql: string, nextPageToken?: string): Promise<JiraSearchPage>;
  board?(id: number, column?: string): Promise<JiraBoard>;
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
