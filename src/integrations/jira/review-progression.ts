import { EngineeringWorkflow } from "../../development/engineering-workflow.js";
import type { HttpClient } from "../http-client.js";
import type { JiraTransition } from "../types/jira-transition.js";
export class JiraReviewProgression {
  constructor(
    private readonly http: HttpClient,
    private readonly move: (target: string) => Promise<void>,
  ) {}
  async advance(key: string): Promise<boolean> {
    const order = EngineeringWorkflow.statuses;
    for (let attempt = 0; attempt < order.length; attempt++) {
      const issue = await this.http.request(
        "/rest/api/3/issue/" + encodeURIComponent(key),
      );
      const current = String(issue.fields.status?.name ?? "");
      if (current.toLowerCase() === "ready for code review") return true;
      const rank = order.findIndex(
        (s) => s.toLowerCase() === current.toLowerCase(),
      );
      if (rank < 0) return false;
      const available = await this.http.request(
        `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      );
      const next = (available.transitions as JiraTransition[])
        .map((t) => t.to?.name)
        .filter(
          (name): name is string =>
            !!name &&
            order.findIndex((s) => s.toLowerCase() === name.toLowerCase()) >
              rank,
        )
        .sort(
          (a, b) =>
            order.findIndex((s) => s.toLowerCase() === a.toLowerCase()) -
            order.findIndex((s) => s.toLowerCase() === b.toLowerCase()),
        )[0];
      if (!next) return false;
      await this.move(next);
    }
    return false;
  }
}
