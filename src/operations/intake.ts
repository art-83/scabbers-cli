import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { ProfileSnapshot } from "../profile/types/profile-snapshot.js";
import type { JiraIssue } from "../integrations/types/jira-issue.js";
import { AssigneePolicy } from "../features/assignee-policy.js";
import { createHash } from "node:crypto";
export class OperationalIntake {
  private stopping = false;
  stop(): void {
    this.stopping = true;
  }
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly jira: IssueTracker,
    private readonly profile: () => ProfileSnapshot,
  ) {}
  enqueue(issue: JiraIssue): void {
    if (this.stopping) return;
    if (
      !this.config.operations.enabled ||
      issue.fields.issuetype.name !== "Ticket" ||
      !new AssigneePolicy(this.config.jira?.accountId).owns(issue)
    )
      return;
    if (
      (issue.fields.labels ?? []).some(
        (label: string) => label.toLowerCase() === "no-auto",
      )
    )
      return;
    if (issue.fields.status?.statusCategory?.key !== "new") return;
    if (
      !JSON.stringify(issue.fields.description).includes(
        "nola-bug-management/report-triage/",
      )
    )
      return;
    if (
      JSON.stringify(issue.fields.allComments ?? []).includes(
        ":operational-execution-started:",
      ) ||
      JSON.stringify(issue.fields.allComments ?? []).includes(
        ":operational-complete:",
      )
    ) {
      this.store.log(
        null,
        "Operational Ticket already has execution/completion evidence; manual reconciliation required before a new run: " +
          issue.key,
      );
      return;
    }
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          key: issue.key,
          description: issue.fields.description,
          assignee: issue.fields.assignee?.accountId,
        }),
      )
      .digest("hex")
      .slice(0, 16);
    const active = this.store
      .list()
      .some(
        (r) =>
          r.kind === "operational" &&
          r.data.issueKey === issue.key &&
          !["done", "handoff", "cancelled"].includes(r.state),
      );
    if (active) return;
    const source = this.store
      .list()
      .find((r) => r.kind === "support" && r.data.destination === issue.key);
    const snapshot = this.profile();
    this.store.create(
      "operational",
      issue.key + "@" + digest,
      this.config.engine,
      snapshot.version,
      {
        issueKey: issue.key,
        issue,
        ...(source
          ? {
              sourceRun: source.id,
              messages: source.data.messages,
              originThreads: source.data.originThreads,
              jiraIssues: source.data.jiraIssues,
            }
          : {}),
        soulSnapshot: snapshot,
        ownerSlackUser: this.config.slack.user,
      },
    );
  }
  async sweep(): Promise<void> {
    if (this.stopping) return;
    if (
      !this.jira.searchPage ||
      !this.config.operations.enabled ||
      !this.config.jira
    )
      return;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          project: this.config.jira.project,
          owner: this.config.jira.accountId,
        }),
      )
      .digest("hex");
    const saved = this.store.getSetting("operational-scan") as
      | { fingerprint?: string; nextPageToken?: string; tokens?: string[] }
      | undefined;
    const previous = saved?.fingerprint === fingerprint ? saved : undefined;
    const jql = `project = ${JSON.stringify(this.config.jira.project)} AND issuetype = Ticket AND assignee = ${JSON.stringify(this.config.jira.accountId)} AND statusCategory = "To Do" ORDER BY created ASC`;
    const page = await this.jira.searchPage(jql, previous?.nextPageToken);
    if (this.stopping) return;
    for (const issue of page.issues)
      if (
        issue.fields.issuetype.name === "Ticket" &&
        new AssigneePolicy(this.config.jira.accountId).owns(issue) &&
        JSON.stringify(issue.fields.description).includes(
          "nola-bug-management/report-triage/",
        )
      )
        this.enqueue(await this.jira.evidence(issue.key));
    if (this.stopping) return;
    if (page.isLast)
      this.store.setSetting("operational-scan", {
        at: Date.now(),
        fingerprint,
      });
    else {
      const tokens = previous?.tokens ?? [];
      if (!page.nextPageToken || tokens.includes(page.nextPageToken))
        throw new Error("Operational Jira pagination stalled");
      this.store.setSetting("operational-scan", {
        at: Date.now(),
        fingerprint,
        nextPageToken: page.nextPageToken,
        tokens: [...tokens, page.nextPageToken],
      });
    }
  }
}
