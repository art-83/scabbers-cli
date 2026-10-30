import type { JiraIssue } from "../../types/jira-issue.js";
import type { IssueImage } from "../../types/issue-image.js";
export interface ImageEvidence {
  prepare(issues: JiraIssue[], signal: AbortSignal): Promise<IssueImage[]>;
}
