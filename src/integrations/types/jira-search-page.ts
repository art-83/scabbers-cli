import type { JiraIssue } from "./jira-issue.js";
export type JiraSearchPage = {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast: boolean;
};
