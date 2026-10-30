import { AssigneePolicy } from "../../features/assignee-policy.js";
import { EngineeringWorkflow } from "../../development/engineering-workflow.js";
import type { JiraSearchPage } from "../types/jira-search-page.js";
import type { JiraBoard } from "../types/jira-board.js";
import { ReportResolver } from "./report-resolver.js";
import type { RoutingPlan } from "../types/routing-plan.js";
import type { IssueTracker } from "../abstractions/interface/issue-tracker.js";
import type { Config } from "../../config/types/config.js";
import { HttpClient } from "../http-client.js";
import { Effects } from "../../runtime/effects.js";
import type { Store } from "../../storage/store.js";
export class JiraClient implements IssueTracker {
  private readonly http: HttpClient;
  private readonly effects: Effects;
  constructor(
    private readonly config: NonNullable<Config["jira"]>,
    token: string,
    private readonly store: Store,
  ) {
    this.http = new HttpClient(config.baseUrl, {
      Authorization:
        "Basic " + Buffer.from(config.email + ":" + token).toString("base64"),
    });
    this.effects = new Effects(store);
  }
  async searchPage(
    jql: string,
    nextPageToken?: string,
  ): Promise<JiraSearchPage> {
    const result = await this.http.request("/rest/api/3/search/jql", "POST", {
      jql,
      maxResults: 100,
      fields: ["*all"],
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    if (
      !Array.isArray(result.issues) ||
      typeof result.isLast !== "boolean" ||
      (!result.isLast && !result.nextPageToken)
    )
      throw new Error("Invalid or incomplete Jira search page");
    return result;
  }
  async board(id: number, columnName = "To Do"): Promise<JiraBoard> {
    const board = await this.http.request(
      `/rest/agile/1.0/board/${id}/configuration`,
    );
    const column = board.columnConfig?.columns?.find(
      (c: any) => c.name === columnName,
    );
    if (!board.filter?.id || !column?.statuses?.length)
      throw new Error("Board filter/To Do column metadata unavailable");
    const filter = await this.http.request(
      `/rest/api/3/filter/${board.filter.id}`,
    );
    if (!filter.jql) throw new Error("Saved board filter is inaccessible");
    return {
      filterId: String(board.filter.id),
      statusIds: column.statuses.map((s: any) => String(s.id)),
      name: String(board.name),
    };
  }
  issue(key: string): Promise<any> {
    return this.http.request("/rest/api/3/issue/" + encodeURIComponent(key));
  }
  async verifyIdentity(): Promise<void> {
    const account = await this.http.request(
      "/rest/api/3/user?accountId=" + encodeURIComponent(this.config.accountId),
    );
    if (!account.active || account.accountId !== this.config.accountId)
      throw new Error(
        "Configured Jira assignee is not an active verified account",
      );
  }
  private async assertFeatureOwner(runId: string, key: string): Promise<void> {
    if (
      this.store.db.prepare("SELECT kind FROM runs WHERE id=?").get(runId)
        ?.kind !== "feature"
    )
      return;
    new AssigneePolicy(this.config.accountId).assert(await this.issue(key));
  }
  async comment(
    runId: string,
    key: string,
    text: string,
    checkpoint = "documentation",
  ): Promise<string> {
    await this.assertFeatureOwner(runId, key);
    const marker = `scabbers:${runId}:${checkpoint}`;
    return this.effects.once(
      runId,
      marker,
      async () => {
        let startAt = 0;
        for (;;) {
          const result = await this.http.request(
            `/rest/api/3/issue/${encodeURIComponent(key)}/comment?startAt=${startAt}&maxResults=100`,
          );
          const existing = result.comments.find((c: any) =>
            JSON.stringify(c.body).includes(marker),
          );
          if (existing) return String(existing.id);
          startAt += result.comments.length;
          if (startAt >= result.total) return undefined;
          if (!result.comments.length)
            throw new Error("Jira pagination stalled");
        }
      },
      async () => {
        const result = await this.http.request(
          `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
          "POST",
          { body: this.document(text + "\n" + marker) },
        );
        return String(result.id);
      },
    );
  }
  async route(
    runId: string,
    reportKey: string,
    plan: RoutingPlan,
  ): Promise<string> {
    if (!["Bug", "Bug Crítico", "Ticket"].includes(plan.type))
      return new ReportResolver(this.http, this.effects).resolve(
        runId,
        reportKey,
        plan,
      );
    await this.verifyIdentity();
    const report = await this.issue(reportKey);
    const marker = `nola-bug-management/report-triage/${reportKey}`;
    if (this.effects.completed(marker + ":conclude")) {
      if (report.fields.status?.statusCategory?.key !== "done")
        throw new Error(
          "Report changed after verified conclusion; inspect concurrent action",
        );
      const existing = this.effects.completed<string>(marker);
      if (!existing)
        throw new Error("Completed routing destination receipt is missing");
      return existing;
    }
    if (report.fields.issuetype.name !== "Report")
      throw new Error("Verified source issue must be a Report");
    const project = report.fields.project?.key;
    if (!project || !["SNOLA", "PNOLA", this.config.project].includes(project))
      throw new Error("Report project is outside configured NOLA scope");
    const metadata = await this.page(
      `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes`,
      "issueTypes",
    );
    const type = metadata.issueTypes.find((t: any) => t.name === plan.type);
    if (!type)
      throw new Error("Requested issue type unavailable in configured project");
    const fields = await this.page(
      `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes/${type.id}`,
      "fields",
    );
    const mapped: Record<string, unknown> = { ...this.config.routingFields };
    for (const field of fields.fields) {
      if (
        (this.config.copyReportFields.includes(field.fieldId) ||
          /squad/i.test(field.name)) &&
        report.fields[field.fieldId] !== undefined
      )
        mapped[field.fieldId] = report.fields[field.fieldId];
    }
    for (const field of fields.fields) {
      const value = mapped[field.fieldId];
      if (value !== undefined && field.allowedValues?.length) {
        const values = Array.isArray(value) ? value : [value];
        if (
          values.some(
            (item: any) =>
              !field.allowedValues.some(
                (allowed: any) =>
                  allowed.id === item?.id ||
                  allowed.value === item?.value ||
                  allowed === item,
              ),
          )
        )
          throw new Error(
            "Configured routing field has an unavailable allowed value: " +
              field.fieldId,
          );
      }
    }
    const required = fields.fields.filter(
      (f: any) =>
        f.required &&
        ![
          "summary",
          "issuetype",
          "project",
          "description",
          "assignee",
        ].includes(f.fieldId) &&
        !f.hasDefaultValue &&
        mapped[f.fieldId] == null,
    );
    if (required.length)
      throw new Error(
        "Routing requires verified Jira field mapping: " +
          required.map((f: any) => f.fieldId).join(", "),
      );
    const destination = await this.effects.once(
      runId,
      marker,
      async () => {
        let nextPageToken: string | undefined;
        do {
          const query = new URLSearchParams({
            jql: `project = "${project}" AND text ~ "report-triage"`,
            fields: "description",
            maxResults: "100",
          });
          if (nextPageToken) query.set("nextPageToken", nextPageToken);
          const result = await this.http.request(
            "/rest/api/3/search/jql?" + query,
          );
          const existing = result.issues?.find((issue: any) =>
            JSON.stringify(issue.fields?.description).includes(marker),
          );
          if (existing) return existing.key;
          nextPageToken = result.nextPageToken;
          if (result.isLast) break;
        } while (nextPageToken);
        return undefined;
      },
      async () => {
        const result = await this.http.request("/rest/api/3/issue", "POST", {
          fields: {
            ...mapped,
            project: { key: project },
            issuetype: { id: type.id },
            summary: plan.summary,
            description: this.document(plan.description + "\n" + marker),
            assignee: { accountId: this.config.accountId },
          },
        });
        if (!/^[A-Z][A-Z0-9]+-\d+$/.test(result.key ?? ""))
          throw new Error(
            "Jira create returned no valid issue key; reconcile the pending effect",
          );
        return String(result.key);
      },
    );
    const verified = await this.issue(destination);
    if (!JSON.stringify(verified.fields.description).includes(marker))
      throw new Error("Destination marker verification failed");
    const links = await this.http.request("/rest/api/3/issueLinkType");
    const relation = links.issueLinkTypes.find(
      (t: any) => t.name === "Relates",
    );
    if (!relation) throw new Error("Jira relates link type unavailable");
    await this.effects.once(
      runId,
      marker + ":link",
      async () => {
        const issue = await this.issue(reportKey);
        return issue.fields.issuelinks?.some(
          (l: any) =>
            l.outwardIssue?.key === destination ||
            l.inwardIssue?.key === destination,
        )
          ? true
          : undefined;
      },
      async () => {
        await this.http.request("/rest/api/3/issueLink", "POST", {
          type: { id: relation.id },
          inwardIssue: { key: reportKey },
          outwardIssue: { key: destination },
        });
        return true;
      },
    );
    await this.comment(
      runId,
      reportKey,
      `Encaminhado para ${this.config.baseUrl}/browse/${destination}. ${plan.description}`,
    );
    const transitions = await this.http.request(
      `/rest/api/3/issue/${encodeURIComponent(reportKey)}/transitions`,
    );
    const done = transitions.transitions.find(
      (t: any) =>
        t.to?.statusCategory?.key === "done" &&
        /^(?:Done|Conclu[ií]do|Finalizado)$/i.test(t.to.name),
    );
    if (!done)
      throw new Error(
        "No verified Done transition available; Report remains open",
      );
    await this.effects.once(
      runId,
      marker + ":conclude",
      async () => {
        const current = await this.issue(reportKey);
        return current.fields.status?.statusCategory?.key === "done"
          ? true
          : undefined;
      },
      async () => {
        await this.http.request(
          `/rest/api/3/issue/${encodeURIComponent(reportKey)}/transitions`,
          "POST",
          { transition: { id: done.id } },
        );
        const current = await this.issue(reportKey);
        if (current.fields.status?.statusCategory?.key !== "done")
          throw new Error("Report transition not verified");
        return true;
      },
    );
    return destination;
  }
  async transition(
    runId: string,
    key: string,
    target: string,
    checkpoint: string,
  ): Promise<void> {
    if (
      this.store.db.prepare("SELECT kind FROM runs WHERE id=?").get(runId)
        ?.kind === "feature"
    )
      new EngineeringWorkflow().assertTarget(target);
    await this.assertFeatureOwner(runId, key);
    const marker = `scabbers:${runId}:transition:${checkpoint}`;
    const matches = (issue: any) => issue.fields.status?.name === target;
    await this.effects.once(
      runId,
      marker,
      async () => (matches(await this.issue(key)) ? true : undefined),
      async () => {
        const available = await this.http.request(
          `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
        );
        const transition = available.transitions.find(
          (t: any) => t.to?.name === target,
        );
        if (!transition)
          throw new Error("Verified Jira transition unavailable: " + target);
        await this.http.request(
          `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
          "POST",
          { transition: { id: transition.id } },
        );
        if (!matches(await this.issue(key)))
          throw new Error("Jira transition result not verified");
        return true;
      },
    );
  }
  private async page(path: string, property: string): Promise<any> {
    let startAt = 0;
    const items: any[] = [];
    for (;;) {
      const result = await this.http.request(
        `${path}?startAt=${startAt}&maxResults=100`,
      );
      const batch = result[property];
      if (!Array.isArray(batch)) throw new Error("Invalid Jira metadata page");
      items.push(...batch);
      startAt += batch.length;
      if (startAt >= result.total) return { [property]: items };
      if (!batch.length) throw new Error("Jira metadata pagination stalled");
    }
  }
  async evidence(key: string): Promise<any> {
    const issue = await this.issue(key);
    issue.fields.allComments = (
      await this.page(
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
        "comments",
      )
    ).comments;
    return issue;
  }
  private document(text: string): unknown {
    return {
      type: "doc",
      version: 1,
      content: text.split("\n").map((line) => ({
        type: "paragraph",
        content: line ? [{ type: "text", text: line }] : [],
      })),
    };
  }
}
