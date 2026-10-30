import type { JiraIssue } from "../../integrations/types/jira-issue.js";
export type Discovery = {
  seed: string;
  ancestors: JiraIssue[];
  root?: string;
  pending: string[];
  nodes: Record<string, JiraIssue>;
  expanding?: { key: string; token?: string; tokens: string[] };
  complete?: boolean;
};
