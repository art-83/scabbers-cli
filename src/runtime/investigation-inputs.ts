import type { Run } from "../workflows/types/run.js";
import type { JiraIssue } from "../integrations/types/jira-issue.js";
import type { SourceThreadEvidence } from "../support/types/thread-evidence.js";

export class InvestigationInputs {
  private issue(issue: JiraIssue | undefined): unknown {
    if (!issue) return null;
    const fields = issue.fields;
    return {
      key: issue.key,
      summary: fields.summary,
      description: fields.description,
      assignee: fields.assignee,
      status: fields.status,
      attachments: fields.attachment,
      comments: (fields.allComments ?? []).filter(
        (comment: unknown) => !JSON.stringify(comment).includes("scabbers:"),
      ),
    };
  }
  read(run: Run): unknown {
    return {
      issue: this.issue(run.data.issue as JiraIssue | undefined),
      jiraIssues: ((run.data.jiraIssues ?? []) as JiraIssue[]).map((issue) =>
        this.issue(issue),
      ),
      messages: run.data.messages,
      origins: ((run.data.originThreads ?? []) as SourceThreadEvidence[]).map(
        ({ capturedAt, ...evidence }) => evidence,
      ),
    };
  }
}
