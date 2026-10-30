import { createHash } from "node:crypto";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { JiraIssue } from "../integrations/types/jira-issue.js";

import type { Family } from "./types/family.js";
import type { Discovery } from "./types/discovery.js";
import { JiraCard } from "./jira-card.js";
export class Hierarchy {
  constructor(private readonly jira: IssueTracker) {}
  private verifyIssue(issue: JiraIssue, key: string): void {
    if (
      issue.key !== key ||
      !issue.fields.issuetype?.name ||
      !issue.fields.project?.key ||
      !["new", "indeterminate", "done"].includes(
        issue.fields.status?.statusCategory?.key ?? "",
      ) ||
      !Array.isArray(issue.fields.labels) ||
      !issue.fields.labels.every((label: unknown) => typeof label === "string")
    )
      throw new Error("Incomplete verified Jira identity/type/status/labels");
  }
  private digest(members: JiraIssue[]): string {
    return createHash("sha256")
      .update(
        JSON.stringify(
          [...members]
            .sort((a, b) => a.key.localeCompare(b.key))
            .map((issue) => {
              const f = issue.fields;
              return {
                key: issue.key,
                summary: f.summary,
                description: f.description,
                type: f.issuetype,
                parent: f.parent?.key,
                assignee: f.assignee?.accountId ?? null,
                labels: f.labels,
                links: f.issuelinks,
                comments: (f.allComments ?? [])
                  .filter(
                    (c: any) => !JSON.stringify(c.body).includes("scabbers:"),
                  )
                  .map((c: any) => ({ id: c.id, body: c.body })),
              };
            }),
        ),
      )
      .digest("hex");
  }
  create(seed: string): Discovery {
    return {
      seed: JiraCard.requireKey(seed),
      ancestors: [],
      pending: [],
      nodes: {},
    };
  }
  // One durable step at a time: an interruption never turns an unfinished family into an orphan.
  async step(state: Discovery): Promise<void> {
    const jira = this.jira;
    if (state.complete) return;
    if (!jira.searchPage)
      throw new Error("Jira enhanced search capability is required");
    if (!state.root) {
      const key = state.ancestors.length
        ? state.ancestors.at(-1)!.fields.parent?.key
        : state.seed;
      if (key) {
        if (state.ancestors.some((i) => i.key === key))
          throw new Error("Jira parent cycle detected");
        const issue = await jira.evidence(JiraCard.requireKey(key));
        if (
          issue.key !== key ||
          !issue.fields.issuetype ||
          !issue.fields.status
        )
          throw new Error("Incomplete Jira ancestor evidence");
        state.ancestors.push(issue);
        return;
      }
      const root =
        state.ancestors.find((i) => new JiraCard(i).isEpic) ??
        [...state.ancestors]
          .reverse()
          .find(
            (i) => new JiraCard(i).isFeature && !i.fields.issuetype.subtask,
          );
      if (!root)
        throw new Error("No supported epic or standalone Story/Task owner");
      state.root = root.key;
      state.pending.push(root.key);
      return;
    }
    if (!state.expanding) {
      const key = state.pending[0];
      if (!key) {
        state.complete = true;
        return;
      }
      const issue = await jira.evidence(JiraCard.requireKey(key));
      this.verifyIssue(issue, key);
      state.nodes[key] = issue;
      state.pending.shift();
      // Explicit subtask references must be readable even if a search silently omits one.
      for (const child of issue.fields.subtasks ?? []) {
        JiraCard.requireKey(child.key);
        if (child.key === key || state.nodes[child.key])
          throw new Error("Jira child cycle detected");
        if (!state.pending.includes(child.key)) state.pending.push(child.key);
      }
      state.expanding = { key, tokens: [] };
      return;
    }
    const page = await jira.searchPage(
      `parent = "${JiraCard.requireKey(state.expanding.key)}" ORDER BY key ASC`,
      state.expanding.token,
    );
    for (const issue of page.issues) {
      JiraCard.requireKey(issue.key);
      if (state.nodes[issue.key])
        throw new Error(
          "Jira descendant cycle or inconsistent parent relation",
        );
      if (!state.pending.includes(issue.key)) state.pending.push(issue.key);
    }
    if (page.isLast) delete state.expanding;
    else {
      if (
        !page.nextPageToken ||
        state.expanding.tokens.includes(page.nextPageToken)
      )
        throw new Error("Jira child pagination stalled");
      state.expanding.tokens.push(page.nextPageToken);
      state.expanding.token = page.nextPageToken;
    }
  }
  complete(state: Discovery): Family {
    if (
      !state.complete ||
      !state.root ||
      state.pending.length ||
      state.expanding
    )
      throw new Error("Family discovery is incomplete");
    const members = Object.values(state.nodes);
    if (!members.length || !state.nodes[state.root])
      throw new Error("Family root evidence missing");
    return {
      root: state.root,
      members,
      ancestors: state.ancestors,
      digest: this.digest(members),
      complete: true,
    };
  }
  async read(root: string): Promise<Family> {
    const state = this.create(root);
    // A guard blocks excessively large synchronous rechecks; it never declares truncated success.
    for (let steps = 0; !state.complete && steps < 5000; steps++)
      await this.step(state);
    return this.complete(state);
  }
}
