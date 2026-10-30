import type { JiraIssue } from "../integrations/types/jira-issue.js";
export class JiraCard {
  constructor(readonly issue: JiraIssue) {
    JiraCard.requireKey(issue.key);
  }
  static requireKey(key: string): string {
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))
      throw new Error("Invalid Jira issue identity");
    return key;
  }
  get isEpic(): boolean {
    return (
      this.issue.fields.issuetype.hierarchyLevel === 1 ||
      /^(epic|épico)$/i.test(this.issue.fields.issuetype.name)
    );
  }
  get isFeature(): boolean {
    return (
      this.isEpic ||
      /^(story|história|task|tarefa|sub-task|subtask|subtarefa)$/i.test(
        this.issue.fields.issuetype.name,
      )
    );
  }
  get isDone(): boolean {
    return this.issue.fields.status?.statusCategory?.key === "done";
  }
}
