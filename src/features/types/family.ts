import type { JiraIssue } from "../../integrations/types/jira-issue.js";
export type Family = {
  root: string;
  members: JiraIssue[];
  ancestors: JiraIssue[];
  digest: string;
  complete: true;
};
