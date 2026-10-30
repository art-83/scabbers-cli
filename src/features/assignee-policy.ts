import type { JiraIssue } from "../integrations/types/jira-issue.js";
export class AssigneePolicy {
  constructor(readonly accountId: string | undefined) {
    if (!accountId || !/^[A-Za-z0-9:_-]{1,200}$/.test(accountId))
      throw new Error(
        "A verified Jira owner account ID is required; unscoped Development intake is forbidden",
      );
  }
  owns(issue: JiraIssue): boolean {
    return issue.fields.assignee?.accountId === this.accountId;
  }
  assert(issue: JiraIssue): void {
    if (!this.owns(issue))
      throw new Error(
        "Jira assignment is outside the configured owner scope: " + issue.key,
      );
  }
}
