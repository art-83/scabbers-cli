import type { HttpClient } from "../http-client.js";
import type { Effects } from "../../runtime/effects.js";
import type { RoutingPlan } from "../types/routing-plan.js";
export class ReportResolver {
  constructor(
    private readonly http: HttpClient,
    private readonly effects: Effects,
  ) {}
  async resolve(
    runId: string,
    key: string,
    plan: RoutingPlan,
  ): Promise<string> {
    const path = `/rest/api/3/issue/${encodeURIComponent(key)}`;
    const report = await this.http.request(path);
    if (report.fields.issuetype?.name !== "Report")
      throw new Error("Routing source must be a verified Report");
    const marker = `nola-bug-management/report-triage/${key}`;
    if (this.effects.completed(marker + ":cancel")) {
      if (
        !/^(cancelado|cancelled|canceled)$/i.test(
          report.fields.status?.name ?? "",
        )
      )
        throw new Error(
          "Report changed after verified cancellation; inspect concurrent human action",
        );
      return plan.destinationKey ?? key;
    }
    if (
      this.effects.completed(marker + ":cancel-reason") &&
      /^(cancelado|cancelled|canceled)$/i.test(report.fields.status?.name ?? "")
    ) {
      await this.effects.once(
        runId,
        marker + ":cancel",
        async () => true,
        async () => true,
      );
      return plan.destinationKey ?? key;
    }
    if (plan.type === "product" || plan.type === "insufficient") {
      await this.comment(
        runId,
        key,
        marker,
        plan.description +
          "\nReport mantido aberto para encaminhamento humano/informação privada.",
      );
      return key;
    }
    let target: any;
    if (plan.type === "duplicate") {
      if (!/^[A-Z][A-Z0-9]+-\d+$/.test(plan.destinationKey ?? ""))
        throw new Error(
          "Duplicate routing requires a verified destination key",
        );
      target = await this.http.request(
        `/rest/api/3/issue/${encodeURIComponent(plan.destinationKey!)}`,
      );
      if (
        !["Bug", "Bug Crítico"].includes(target.fields.issuetype?.name) ||
        target.fields.status?.statusCategory?.key === "done"
      )
        throw new Error("Duplicate destination must be an open verified Bug");
    }
    const metadata = await this.http.request(path + "/editmeta");
    const entry = Object.entries(metadata.fields ?? {}).find(
      ([, field]: [string, any]) =>
        /motivo.*cancel|cancel.*reason/i.test(field.name ?? ""),
    ) as [string, any] | undefined;
    const reason =
      plan.type === "duplicate" ? "Duplicado" : plan.cancellationReason;
    const option = entry?.[1].allowedValues?.find(
      (value: any) => value.value === reason || value.name === reason,
    );
    if (!entry || !option?.id)
      throw new Error(
        "Live Jira cancellation reason field/option unavailable; Report remains open",
      );
    const transitions = await this.http.request(path + "/transitions");
    const cancel = transitions.transitions.find(
      (transition: any) =>
        transition.to?.statusCategory?.key === "done" &&
        /^(cancelado|cancelled|canceled)$/i.test(transition.to?.name ?? ""),
    );
    if (!cancel)
      throw new Error(
        "Verified Jira cancellation transition unavailable; Report remains open",
      );
    if (target) {
      await this.comment(
        runId,
        target.key,
        marker + ":occurrence",
        plan.description + `\nNova ocorrência no Report ${key}.`,
      );
      const types = await this.http.request("/rest/api/3/issueLinkType");
      const relation =
        types.issueLinkTypes.find((type: any) =>
          /duplicates?/i.test(type.name),
        ) ?? types.issueLinkTypes.find((type: any) => type.name === "Relates");
      if (!relation)
        throw new Error("No verified duplicate/relates relationship available");
      await this.effects.once(
        runId,
        marker + ":duplicate-link",
        async () => {
          const current = await this.http.request(path);
          return current.fields.issuelinks?.some(
            (link: any) =>
              link.outwardIssue?.key === target.key ||
              link.inwardIssue?.key === target.key,
          )
            ? true
            : undefined;
        },
        async () => {
          await this.http.request("/rest/api/3/issueLink", "POST", {
            type: { id: relation.id },
            inwardIssue: { key },
            outwardIssue: { key: target.key },
          });
          const current = await this.http.request(path);
          if (
            !current.fields.issuelinks?.some(
              (link: any) =>
                link.outwardIssue?.key === target.key ||
                link.inwardIssue?.key === target.key,
            )
          )
            throw new Error("Duplicate relationship was not verified");
          return true;
        },
      );
    }
    await this.comment(
      runId,
      key,
      marker,
      plan.description +
        (target ? `\nDestino duplicado: ${target.key}.` : "") +
        `\nMotivo: ${reason}.`,
    );
    const fieldId = entry[0];
    await this.effects.once(
      runId,
      marker + ":cancel-reason",
      async () => {
        const current = await this.http.request(path);
        return current.fields[fieldId]?.id === option.id ? true : undefined;
      },
      async () => {
        await this.http.request(path, "PUT", {
          fields: { [fieldId]: { id: option.id } },
        });
        const current = await this.http.request(path);
        if (current.fields[fieldId]?.id !== option.id)
          throw new Error("Cancellation reason was not verified");
        return true;
      },
    );
    await this.effects.once(
      runId,
      marker + ":cancel",
      async () => {
        const current = await this.http.request(path);
        return current.fields.status?.id === cancel.to.id ? true : undefined;
      },
      async () => {
        await this.http.request(path + "/transitions", "POST", {
          transition: { id: cancel.id },
        });
        const current = await this.http.request(path);
        if (current.fields.status?.id !== cancel.to.id)
          throw new Error("Report cancellation was not verified");
        return true;
      },
    );
    return target?.key ?? key;
  }
  private async comment(
    runId: string,
    key: string,
    marker: string,
    text: string,
  ): Promise<string> {
    const path = `/rest/api/3/issue/${encodeURIComponent(key)}/comment`;
    return this.effects.once(
      runId,
      marker + ":comment:" + key,
      async () => {
        let startAt = 0;
        for (;;) {
          const page = await this.http.request(
            `${path}?startAt=${startAt}&maxResults=100`,
          );
          const found = page.comments.find((comment: any) =>
            JSON.stringify(comment.body).includes(marker),
          );
          if (found) return String(found.id);
          startAt += page.comments.length;
          if (startAt >= page.total) return undefined;
          if (!page.comments.length)
            throw new Error("Jira comments pagination stalled");
        }
      },
      async () => {
        const result = await this.http.request(path, "POST", {
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: text + "\n" + marker }],
              },
            ],
          },
        });
        if (!result.id) throw new Error("Jira comment outcome unknown");
        return String(result.id);
      },
    );
  }
}
