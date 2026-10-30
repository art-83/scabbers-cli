import { EngineeringWorkflow } from "../development/engineering-workflow.js";
import { JiraCard } from "./jira-card.js";
import type { Family } from "./types/family.js";
import type { FeatureForm } from "./types/feature-form.js";
export class FamilyPolicy {
  constructor(private readonly workflow = new EngineeringWorkflow()) {}
  blocker(
    family: Family,
    owned: string[] = [],
    scope?: string[],
  ): string | undefined {
    for (const issue of [...family.members, ...family.ancestors]) {
      if (scope && !scope.includes(issue.key) && !new JiraCard(issue).isEpic)
        continue;
      if (
        (issue.fields.labels ?? []).some(
          (l: string) => l.toLowerCase() === "no-auto",
        )
      )
        return `Opt-out on ${issue.key}`;
      if (!new JiraCard(issue).isDone && !new JiraCard(issue).isFeature)
        return `Unsupported or mixed bug/feature family: ${issue.key}`;
      if (
        !new JiraCard(issue).isEpic &&
        !new JiraCard(issue).isDone &&
        !this.workflow.includes(issue.fields.status?.name ?? "")
      )
        return `Outside the approved engineering workflow: ${issue.key}`;
      if (
        !new JiraCard(issue).isEpic &&
        !new JiraCard(issue).isDone &&
        issue.fields.status?.statusCategory?.key === "indeterminate" &&
        !owned.includes(issue.key)
      )
        return `Active work requires an explicit resolution: ${issue.key}`;
    }
    if (
      !family.members.some(
        (i) =>
          !new JiraCard(i).isDone &&
          !new JiraCard(i).isEpic &&
          (!scope || scope.includes(i.key)),
      )
    )
      return "Family has no pending engineering work";
    return undefined;
  }

  coverage(form: FeatureForm, family: Family, scope: string[]): void {
    const keys = form.coverage.map((c) => c.key);
    if (
      new Set(keys).size !== keys.length ||
      keys.length !== family.members.length ||
      family.members.some((i) => !keys.includes(i.key))
    )
      throw new Error(
        "Feature coverage must include every family member exactly once",
      );
    for (const entry of form.coverage) {
      if (
        entry.disposition !==
        (scope.includes(entry.key) &&
        !new JiraCard(family.members.find((i) => i.key === entry.key)!).isEpic
          ? "implement"
          : "context")
      )
        throw new Error("Completed or out-of-scope work cannot be implemented");
      const issue = family.members.find((i) => i.key === entry.key)!;
      const links = (issue.fields.issuelinks ?? [])
        .flatMap((l: any) => [l.inwardIssue?.key, l.outwardIssue?.key])
        .filter(Boolean);
      if (
        entry.dependencies.some(
          (key) => !keys.includes(key) && !links.includes(key),
        )
      )
        throw new Error("Feature dependencies must refer to verified cards");
    }
  }
}
